# Skills Seminar

Claude Code Skills를 활용한 Lambda-style Agent 데모 프로젝트입니다.

## Skills 목록

### headless-agent-ui (lambda app)

CLI 기반 AI 도구(opencode, gemini-cli, claude 등)를 웹 채팅 인터페이스로 감싸는 풀스택 TypeScript 앱입니다.

- **구조**: React 프론트엔드 + Express 백엔드 + CLI subprocess 스트리밍 (SSE)
- **실행**: Docker 기반, `scaffold/` 디렉토리에 자체 완결 — scaffold 파일은 절대 수정하지 않음
- **멀티 인스턴스**: `run.sh`가 프로젝트명과 포트를 자동 감지하여 충돌 없이 여러 인스턴스 실행 가능
- **켜기 트리거**: `lambda app 켜줘`, `앱 실행`, `skill app` 등
- **끄기 트리거**: `lambda app 꺼줘`, `꺼줘`, `stop the app` 등

### generate-haiku

주어진 주제로 하이쿠(5-7-5)를 생성합니다. `save-to-file`과 체이닝되어 결과를 파일로 저장합니다.

### save-to-file

생성된 콘텐츠를 워크스페이스의 `output.md` 파일로 저장합니다.

### hello-jet

Jet에게 인사하는 테스트용 스킬입니다.

### gitignore-scaffold

scaffold가 생성한 파일들이 git에 추적되지 않도록 `.gitignore`를 설정합니다.

## 사용법

```bash
# 앱 실행 (이름만 넘기면 포트 자동 배정)
APP_NAME="My Agent" .claude/skills/headless-agent-ui/scaffold/run.sh

# 앱 종료
.claude/skills/headless-agent-ui/scaffold/stop.sh

# 여러 인스턴스 동시 실행 — 이름만 다르게 주면 됨
APP_NAME="Agent A" .claude/skills/headless-agent-ui/scaffold/run.sh
APP_NAME="Agent B" .claude/skills/headless-agent-ui/scaffold/run.sh
```

## 프로젝트 구조

```
.claude/skills/
├── headless-agent-ui/     # 메인 Lambda App 스킬 (켜기 + 끄기 통합)
│   ├── SKILL.md
│   └── scaffold/          # 자체 완결 Docker 프로젝트 (불변 템플릿)
│       ├── docker-compose.yml
│       ├── Dockerfile
│       ├── run.sh         # 자동 프로젝트명 + 포트 감지 실행 스크립트
│       ├── stop.sh        # 자동 프로젝트명 감지 종료 스크립트
│       ├── server/index.ts
│       └── src/App.tsx
├── generate-haiku/        # 하이쿠 생성 스킬
├── save-to-file/          # 파일 저장 스킬
├── hello-jet/             # 인사 테스트 스킬
└── gitignore-scaffold/    # .gitignore 설정 스킬
```
