# AWS Lambda-style Skill App -- ALL DONE

Goal: 프로젝트 폴더 = Lambda App, 각 Skill = Lambda Function, Web UI = API Gateway

```
my-app/
└── .claude/skills/
    ├── hello-jet/SKILL.md        <- Function 1
    ├── generating-ppt/SKILL.md   <- Function 2
    └── data-analysis/SKILL.md    <- Function 3
```

---

## Phase 1: Skill Discovery -- DONE
- [x] SKILL.md frontmatter 파서 (name, description, provider, model, chain)
- [x] 서버 시작 시 project + global skills 스캔 & 캐싱
- [x] `GET /api/skills` 엔드포인트

## Phase 2: Skill Matching -- DONE
- [x] OpenRouter API + claude-haiku-4.5로 LLM 기반 스킬 매칭
- [x] 매칭된 스킬의 SKILL.md 전체 내용 로드

## Phase 3: Skill-Injected Chat -- DONE
- [x] SKILL.md를 프롬프트에 주입하여 CLI 실행
- [x] 매칭 실패 시 스킬 목록 안내

## Phase 4: Frontend UI -- DONE
- [x] 스킬 카드 목록 (scope 뱃지: project/global)
- [x] 스킬 뱃지 + provider/model 표시
- [x] 파일 다운로드 링크
- [x] 체인 스텝 표시

## Future (All Implemented) -- DONE

- [x] **Hot-reload**: fs.watch로 skills 디렉토리 감시, 변경 시 자동 재스캔
- [x] **Per-skill provider/model**: SKILL.md frontmatter에 `provider`, `model` 지정 가능
      사용자 선택보다 스킬 설정이 우선
- [x] **File download**: CLI 실행 전후 워크스페이스 diff → 새 파일 감지 → 다운로드 링크
- [x] **Global scope**: ~/.claude/skills/ 스캔 (docker-compose에 볼륨 마운트)
      프로젝트 스킬이 동일 이름의 글로벌 스킬을 오버라이드
- [x] **Skill chaining**: SKILL.md frontmatter에 `chain: skill-a, skill-b` 지정
      이전 스킬 출력 → 다음 스킬 입력으로 순차 실행

---

## SKILL.md Frontmatter Reference

```yaml
---
name: my-skill
description: What this skill does (used for LLM matching)
provider: opencode          # optional: override user's provider selection
model: openrouter/gpt-4o    # optional: override user's model selection
chain: step-2, step-3       # optional: run these skills after this one
---
```
