# Headless Agent UI (Lambda App) 기술 문서

CLI 기반 AI 에이전트(opencode, gemini-cli 등)를 ChatGPT 스타일의 웹 채팅 UI로 감싸는 풀스택 TypeScript 앱.
Docker로 self-contained 배포되며, "lambda app"이라고도 불린다.

## 아키텍처

```
Browser (React/Vite)
   │
   │  POST /api/chat (SSE stream)
   ▼
Express Server (server/index.ts)
   │
   │  spawn child process
   ▼
CLI subprocess (gemini / opencode)
   │
   │  stdout pipe → SSE chunks
   ▼
Browser에서 토큰 단위 실시간 렌더링
```

## 핵심 컴포넌트

### 1. Backend — `server/index.ts`

| 기능 | 설명 |
|------|------|
| Location-aware API config | `PROJECT_A2G_LOCATION` 환경변수로 CORP/DEV/HOME 환경 감지 → 각각 on-prem LiteLLM 또는 OpenRouter로 API 키 라우팅 |
| SkillRegistry 통합 | 워크스페이스의 `.claude/skills/` + `.agents/skills/` + 글로벌 `~/.claude/skills/` 스캔, hot-reload 지원 |
| 2-Turn 오케스트레이션 | **Turn 1**: 쿼리 + 스킬 목록 → 키워드/LLM 매칭으로 적합한 스킬 선택. **Turn 2**: 선택된 스킬의 SKILL.md 전문을 프롬프트에 주입 → CLI 실행 |
| 모델 동적 로딩 | `/api/models/gemini-cli` — gemini-cli-fork에서 모델 목록 추출, `/api/models/opencode` — opencode config + CLI에서 모델 목록 파싱 |
| 파일 생성 감지 | 요청 전후 워크스페이스 파일 snapshot → diff → 새 파일을 `files` SSE 이벤트로 전송 → 브라우저에서 다운로드 제공 |
| URL 프리페치 | 쿼리에 URL이 포함되면 자동으로 HTML 가져와서 텍스트 추출 후 프롬프트에 주입 |
| 대화 히스토리 | 최근 10턴을 `<conversation_history>` 태그로 프롬프트에 삽입 |

### 2. Skill Router — `server/skills.ts`

스킬 매칭은 2단계로 동작한다.

#### Step 1: 키워드 매칭 (빠름, API 불필요)

```typescript
// 1) 스킬 이름이 쿼리에 포함되면 즉시 매칭
if (queryLower.includes(nameLower)) → 매칭

// 2) description에서 키워드 2개 이상 겹치면 매칭
const matchCount = keywords.filter(k => queryLower.includes(k)).length;
if (matchCount >= 2) → 매칭

// 3) 동의어 사전 (termMappings)으로 매칭
const termMappings = {
  'headless-agent-ui': ['lambda', 'app', 'web', 'ui', 'headless'],
};
if (relatedTerms.some(term => queryLower.includes(term))) → 매칭
```

#### Step 2: LLM 매칭 (키워드로 못 찾으면 fallback)

스킬 목록 + 쿼리를 LLM에 보내서 "어떤 스킬이 맞아?" 물어본다.

- on-prem OpenAI-compatible API (Kimi-K2.5-Thinking 모델) 시도
- 실패 시 OpenRouter (claude-haiku-4-5) fallback
- LLM은 스킬명 또는 "none"을 반환

#### 기타 기능

- `fs.watch`로 스킬 디렉토리 hot-reload
- 스킬 체이닝 (`chain` frontmatter로 순차 실행)
- 프로젝트 스킬이 글로벌 스킬과 이름 충돌 시 프로젝트 우선
- `.claude/skills/`와 `.agents/skills/` 간 중복 제거 (먼저 발견된 것 우선)

### 3. Frontend — `src/App.tsx`

- **Provider 토글**: gemini-cli / opencode 전환
- **모델 선택**: 각 provider별 동적 모델 드롭다운
- **SSE 스트리밍**: `ReadableStream` API로 토큰 단위 렌더링 + 깜빡이는 커서
- **스킬 배지**: 서버에서 `{ type: 'skill', name: 'pptx' }` SSE 이벤트를 수신하면 메시지에 보라색 배지 표시
- **파일 다운로드**: 에이전트가 생성한 파일을 다운로드 링크로 제공
- **다크/라이트 테마**: localStorage 기반 퍼시스턴스
- **중지 버튼**: `AbortController`로 SSE 스트림 취소
- **headless-agent-ui 필터링**: 자기 자신은 스킬 목록에서 제외

## 스킬 배지 동작 원리

1. **서버**: 스킬 매칭 성공 시 CLI 실행 전에 `{ type: 'skill', name: 'pptx' }` SSE 이벤트 전송
2. **프론트엔드**: `type: 'skill'` 이벤트 수신 → 해당 메시지 객체에 `skillName` 저장
3. **렌더링**: `skillName`이 있으면 `SKILL pptx` 배지를 메시지 상단에 표시

실제 스킬 "사용"이라기보다 "매칭 성공"의 표시이다.

## SSE 이벤트 프로토콜

| type | 용도 |
|------|------|
| `chunk` | stdout 텍스트 (채팅에 렌더링) |
| `status` | stderr (연결 유지용, UI 미표시) |
| `skill` | 매칭된 스킬명 표시 |
| `files` | 새로 생성된 파일 경로 목록 |
| `done` | 프로세스 종료 + exit code |
| `error` | spawn 에러 |

## Docker 인프라

| 파일 | 역할 |
|------|------|
| `Dockerfile` | node:20-slim + Python3/pip + LibreOffice + pptxgenjs (문서 생성 스킬용) |
| `docker-compose.yml` | 워크스페이스, gemini-cli-fork, opencode 바이너리, 설정 파일들을 볼륨 마운트 |
| `docker-entrypoint.sh` | gemini CLI 래퍼 생성, opencode config의 `127.0.0.1` → `host.docker.internal` 치환 |
| `run.sh` | 자동 포트 탐색(3001~), APP_NAME 기반 인스턴스 분리, `docker compose up -d` |
| `stop.sh` | 실행 중인 컨테이너를 label로 자동 탐지 후 `docker compose down` |

### 이미지 & 컨테이너 네이밍

- **이미지**: `headless-agent-ui:latest` (고정, 모든 인스턴스가 공유)
- **컨테이너**: `{COMPOSE_PROJECT_NAME}-lambda-{인스턴스번호}` (동적)
  - 예: `sw_inno_team_skills_seminar-document-agent-lambda-1`
- **COMPOSE_PROJECT_NAME**: `{프로젝트디렉토리명}-{APP_NAME 슬러그}`
  - 슬러그: 소문자 변환 → 영숫자 아닌 문자를 `-`로 치환 → 앞뒤 `-` 제거
- **포트**: 3001부터 순차 탐색하여 빈 포트 자동 할당

### 빌드 관련

- `--build` 플래그 없이 `run.sh` 실행 시 기존 이미지를 재사용 (빌드 안 함)
- `run.sh --build`로 강제 리빌드
- Docker Hub(`registry-1.docker.io`) 접근이 간헐적으로 차단될 수 있으므로, 접근 가능할 때 미리 빌드해두는 것을 권장

## SSE 스트리밍 핵심 교훈

| 교훈 | 이유 |
|------|------|
| `req.on('close')`로 서브프로세스 kill 금지 | Vite 프록시가 premature close 발생시킴 |
| `res.flushHeaders()` 즉시 호출 필수 | 안 하면 헤더가 버퍼링됨 |
| 하트비트 코멘트(`: heartbeat\n\n`) 즉시 전송 | CLI 부팅 중 커넥션 유지 |
| `X-Accel-Buffering: no` 양쪽 설정 | Express + Vite proxy 모두에서 버퍼링 비활성화 |

## 설계 특징

- **Self-contained**: scaffold 파일은 프로젝트 루트에 복사하지 않음, Docker 내에서 빌드
- **Multi-instance**: APP_NAME 기반으로 컨테이너/포트가 자동 분리되어 여러 앱 동시 실행 가능
- **환경 적응형**: 사내(CORP), 개발(DEV), 홈(HOME) 환경에 따라 API 엔드포인트 자동 전환
- **Progressive Disclosure**: 스킬 라우팅은 가벼운 1차 매칭 → 선택 시 전체 SKILL.md 주입의 2단계 구조로 토큰 절약
