# Skills Seminar

Claude Code Skills를 활용한 Lambda-style Agent 데모 프로젝트입니다.

## Skills 목록

### headless-agent-ui (lambda app)

CLI 기반 AI 도구(opencode, gemini-cli, claude 등)를 웹 채팅 인터페이스로 감싸는 풀스택 TypeScript 앱입니다.

- **구조**: React 프론트엔드 + Express 백엔드 + CLI subprocess 스트리밍 (SSE)
- **실행**: Docker 기반, `scaffold/` 디렉토리에 자체 완결
- **멀티 인스턴스**: `COMPOSE_PROJECT_NAME`과 `HOST_PORT`로 프로젝트별 독립 실행 가능
- **트리거**: `lambda app 켜줘`, `앱 실행`, `skill app` 등

### clean-scaffold

headless-agent-ui 컨테이너를 정리하고 프로젝트를 초기 상태로 복원합니다.

- Docker 컨테이너/이미지/볼륨 일괄 제거
- 프로젝트 루트에 남은 scaffold 파일 정리
- **트리거**: `lambda app 꺼줘`, `꺼줘`, `stop the app` 등

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
# 앱 실행 (Docker)
cd .claude/skills/headless-agent-ui/scaffold
docker compose up -d --build
# http://localhost:3001

# 앱 종료
docker compose down
```

## 프로젝트 구조

```
.claude/skills/
├── headless-agent-ui/     # 메인 Lambda App 스킬
│   ├── SKILL.md
│   └── scaffold/          # 자체 완결 Docker 프로젝트
│       ├── docker-compose.yml
│       ├── Dockerfile
│       ├── server/index.ts
│       └── src/App.tsx
├── clean-scaffold/        # 앱 정리 스킬
├── generate-haiku/        # 하이쿠 생성 스킬
├── save-to-file/          # 파일 저장 스킬
├── hello-jet/             # 인사 테스트 스킬
└── gitignore-scaffold/    # .gitignore 설정 스킬
```
