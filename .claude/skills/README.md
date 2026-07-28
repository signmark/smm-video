# .claude/skills — скиллы агента

**Источник:** `hermes-vault/skills` (личное хранилище владельца), срез 2026-07-28.
**Установлено:** 43 из 183. Отбор — под это окружение: эфемерный Linux-контейнер, работа с
репозиториями владельца, git/GitHub, Node и Python. Скопированы целиком, включая `references/`,
`scripts/` и `templates/`, имена сплющены до одного уровня (`software-development/plan` → `plan`).

Лежат в репозитории, а не в `~/.claude/`, сознательно: контейнер сессии эфемерный, домашний
каталог с ним умирает. В `.gitignore` для этого стоит `.claude/*` с исключением `!.claude/skills/` —
личный `settings.local.json` по-прежнему не версионируется.

## Что установлено

| Группа | Скиллы |
|---|---|
| Методология разработки | api-and-interface-design, spec-driven-development, planning-and-task-breakdown, writing-plans, incremental-implementation, test-driven-development, doubt-driven-development, source-driven-development, deprecation-and-migration, documentation-and-adrs |
| Качество и отладка | code-review-and-quality, requesting-code-review, code-simplification, debugging, debugging-and-error-recovery, systematic-debugging, performance-optimization, dogfood |
| Безопасность | security-and-hardening, secret-leak-remediation, oauth-token-management, secure-service-tunneling |
| Git и GitHub | git-workflow-and-versioning, github-repo-management, github-pr-workflow, github-code-review, github-issues, codebase-inspection |
| Продукт и фронт | frontend-ui-engineering, shipping-and-launch, spike, autonomous-saas-factory, market-research |
| Данные и сеть | web-scraping-and-anti-bot-bypass, resilient-web-research, api-probing |
| Работа агента | context-engineering, using-agent-skills, pragmatic-vibe-coding |
| Оформление | html-plan, html-diagram, architecture-diagram, humanizer |

## Что не установлено и почему

- **Не работает в этом окружении** (≈90 скиллов): всё под macOS (`apple/*`, `macos-computer-use`),
  под WSL и хост владельца (`wsl-*`, `systemd-user-services`, `hermes-gateway-operations`,
  `hermes-cronjob-troubleshooting`, `vault-git-sync`), под его Hermes-инстансы и Kanban
  (`hermes-*`, `kanban-*`), Telegram-юзерботы с его сессией (`telegram-*`, `morning-scout-run`),
  MLOps с GPU (`vllm`, `llama-cpp`, `audiocraft`, `segment-anything`), внешние сервисы под ключи
  (`notion`, `linear`, `airtable`, `spotify`, `google-workspace`), а также creative/gaming/
  smart-home — они не про задачи этого репозитория.
- **Устаревшие по собственной пометке:** `telegram_scout`, `tg_scout_digest`, `format-digest`.
- **Не устанавливаются сознательно:** `model-safety-bypass`, `red-teaming/godmode`,
  `mlops/inference/obliteratus` — это обход ограничений языковых моделей (джейлбрейки и
  аблитерация отказов на уровне весов). Ставить их себе в набор я не буду; в хранилище они
  остаются, это не удаление.

## Как обновлять

Хранилище — источник, этот каталог — срез. При изменении скилла в `hermes-vault` копировать
сюда заново; расхождение решается в пользу хранилища.
