# Awesome Agent Orchestrators

**Источник:** https://github.com/andyrewlee/awesome-agent-orchestrators
**Звёзды:** 932 | **Форки:** 116
**Обновлено:** 2026-07-04

> Каталог 125+ инструментов для оркестрирования ИИ-агентов: параллельные раннеры, персональные ассистенты, мультиагентные системы и автономные циклы.

---

## 🏆 ТОП-10 (рекомендации для SMM Video / Clipos Studio)

| Инструмент | Зачем | Ссылка |
|------------|-------|--------|
| **bernstein** | Детерминированный оркестратор: параллельные агенты + тесты + автокоммиты. **0 токенов на координацию** | [GitHub](https://github.com/chernistry/bernstein) |
| **agentbox** | Песочницы (Docker/VM) для агентов, sub-1s checkpoint | [GitHub](https://github.com/madarco/agentbox) |
| **sortie** | Превращает issue из трекера в автономные сессии агентов (Go бинарник, SQLite) | [GitHub](https://github.com/sortie-ai/sortie) |
| **symphony** | OpenAI: изолированные автономные implementation-раны | [GitHub](https://github.com/openai/symphony) |
| **5dive** | "Компания" агентов с org chart, handoffs, Telegram эскалация | [GitHub](https://github.com/5dive-ai/5dive) |
| **clideck** | WhatsApp-like дашборд для управления агентами, контроль с телефона | [GitHub](https://github.com/rustykuntz/clideck) |
| **ivy-tendril** | Claude Code + Codex + Antigravity + Copilot; verification gates, self-improving memory | [GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril) |
| **takopi** | Telegram-мост для Codex/Claude Code/OpenCode | [GitHub](https://github.com/banteg/takopi) |
| **parallel-code** | Desktop: изолированные git worktrees, diff viewer, one-click merge | [GitHub](https://github.com/johannesjo/parallel-code) |
| **dmux** | Параллельные агенты через tmux + worktrees | [GitHub](https://github.com/standardagents/dmux) |

---

## 📂 Категории

### 🔄 Parallel Agent Runners (50+)
Запуск нескольких агентов одновременно на разных задачах.

- **1code** — UI для Claude Code, local/remote
- **agent-deck** — Terminal session manager
- **agent-kanban** — Kanban с leader-worker моделью, крипто-идентичность агентов
- **AGX** — Local-first, wake-work-sleep checkpointing
- **amux** — TUI для параллельных агентов
- **automaker** — Автономная AI-студия
- **claude-squad** — Управление несколькими агентами в фоне
- **constellagent** — macOS: терминал + редактор + git worktree на агента
- **crystal** — Параллельные сессии Codex и Claude Code
- **dorothy** — Desktop: автоматизации, Kanban, MCP
- **herdr** — Terminal multiplexer с persistent workspaces
- **humanlayer** — Решение сложных задач в кодовых базах
- **mux** — Desktop для изолированной параллельной работы
- **nimbalyst** — Visual workspace + kanban + visual editing
- **OpenCode Hub** — Оркестрация Claude Code + Codex + Kimi
- **orchestrator-cli** — Координация Claude Code + Codex + Gemini CLI
- **Orca** — IDE для CLI агентов в git worktrees
- **Proliferate** — Open-source agent IDE для параллельной работы
- **rayo** — Claude Code + tmux: терминальный IDE, autocompact, review-режим
- **subagent-starter** — Шаблон для запуска Claude подагентов
- **superset** — Терминал для coding-агентов
- **t3code** — Минимальный web GUI
- **thurbox** — Multi-session TUI, SSH, inter-session messaging
- **tmux-ide** — Tmux-powered IDE с agent-team шаблонами
- **tutti** — Multi-agent CLI с config-driven workflow
- **vibecraft** — RTS-style workspace для агентов
- **vibe-kanban** — Kanban для AI кодирования
- **voos** — Multi-agent IDE с автономным автотестированием
- **vsm** — VS Code для coding-агентов (fork Continue)
- **weave** — CLI для Claude Code: worktrees, tmux, git, AI review
- **wharf** — Multi-agent IDE с Kanban
- **Zinc** — Multi-agent CLI, macOS sandbox

### 🤖 Personal Assistants (8)
- **babyagi3** — Минимальный AI-агент, настраиваешь один раз
- **ghostclaw** — AI-агент, живущий на компьютере
- **leon** — Open-source ассистент с голосом и текстом
- **lettabot** — Персональный ассистент с памятью
- **openclaw** — Персональный AI-ассистент
- **rho** — AI-агент с памятью между сессиями, self-check-in
- **rowboat** — Open-source AI-коллега с памятью
- **takopi** — Telegram-мост для Codex/Claude Code/OpenCode

### 🐝 Multi-Agent Swarms (10+)
- **claude-code-swarm** — Мультиагентная система из Claude Code + MCP
- **Code-Harvest** — Несколько агентов собирают контекст из разных источников
- **conductor** — Канбан-бюллетень с тикетами для параллельных Claude агентов
- **cyberstorm** — Сравнение нескольких coding-агентов на одной задаче
- **DevSync** — Claude Code + tmux + Git, координация без LLM
- **hermes-cli** — Мультиагентная система с Gemini CLI + Claude Code + OpenCode
- **heroku** — Multi-agent coding с визуализацией в реальном времени
- **kilo-swarm** — Автономные агенты в Git worktrees
- **multi-agents** — Claude Code + Codex + Gemini CLI с shared memory
- **swarm-orchestrator** — Управление Swarm агентами
- **tandem** — Два Claude Code агента работают в паре

### 🔄 Autonomous Loops (10+)
- **Auto-Coder** — Автономное программирование с генерацией и тестированием
- **autopack** — Автономный coding-агент с sandbox-секцией
- **devflow** — Autonomouse coding workflow (planning → implementation → review)
- **Ditto** — AI-ассистент с autocompact и memory
- **hera** — Claude Code агент с workflow, memory и guardrails
- **hermes-agent** — CLI для автономного кодирования с интеграцией DevOps
- **lucidity** — Автономные циклы с memory, self-correction и human-in-the-loop
- **mindcraft** — Запуск Claude агентов в Minecraft
- **multiswift** — Синхронизация нескольких Claude Code агентов через git
- **Neurosync** — Мультиагентная автономная система для кодирования
- **OpenSpec** — Автономная спецификация, ревью и кодинг
- **Orchestrator** — Паттерны оркестрации для coding-агентов
- **sentinel** — Автономный security-ревью для Claude Code
- **swift-sync** — Быстрая синхронизация Claude Code агентов через git

### 📋 Контекст и Memory (8)
- **brain** — Автономный coding-ассистент с persistent memory и миграцией
- **claude-memory** — CLI для памяти Claude Code
- **CodeHarvest** — Aggregator контекста из разных источников для coding-агентов
- **context-forge** — Автономный инструмент для создания контекста из репозитория
- **context-optimizer** — Удаление дублирующего контекста для coding-агентов
- **context-pilot** — AI-powered навигация по коду
- **MemoryBank** — Persistent память с автоматическим архивированием
- **mimo-agents** — Агенты с shared memory для параллельного кодирования

### 🔧 Управление ресурсами
- **Agent Pool Manager** — Управление пулом coding-агентов с load balancing
- **agentpool** — Multi-agent coding с Docker sandbox
- **Buddy** — Мультиагентная система с Docker изоляцией и rate limiting
- **CodeFusion** — AI-powered мультиагентный coding с dynamic routing
- **PoolAgent** — Мультиагентный coding с session management и pooling

### 🧩 Модульные/Pluggable системы
- **AgentKit** — Сборка multi-agent систем из модулей
- **AgentSwap** — Runtime-замена агентов без остановки workflow
- **Architect** — Модульный coding pipeline с verification
- **Cortex** — Управление агентами с plugin-based архитектурой
- **Nexus CLI** — CLI для coding-агентов с plugin-based расширениями

### 📊 Мониторинг и Analytics
- **AgentLens** — Визуализация и трекинг multi-agent workflow
- **AgentWatch** — Real-time мониторинг coding-агентов
- **Claude Watchdog** — Мониторинг Claude Code сессий
- **Codex Watchdog** — Мониторинг OpenAI Codex агентов
- **DevPulse** — AI-powered мониторинг developer productivity

### 🔀 Оркестрация и Workflow
- **AgentGraph** — DAG-based workflow engine для coding-агентов
- **Conductor** — Управление coding-сессиями через CLI
- **CrewAgent** — Multi-agent workflow с role-based orchestration
- **FlowForge** — Visual workflow builder для coding-агентов
- **PipelinePilot** — Автономный coding pipeline с stages

### 🛡️ Безопасность
- **Claude Guardrails** — Guardrails для Claude Code
- **SecureAgent** — Безопасный multi-agent coding с sandbox
- **Sentinel** — Autonomous security review

### 🔀 Git и Worktrees
- **GitBot** — Управление coding workflow через git
- **GitWorktree Hub** — Управление несколькими git worktrees для агентов
- **Worktree Manager** — CLI для создания и управления git worktrees

### 🧪 Тестирование
- **Auto-Tester** — Автономное тестирование coding-агентов
- **TestForge** — AI-powered тестирование для coding-агентов
- **VerifyBot** — Автономная верификация кода

### 📱 CLI/TUI/Dashboard
- **agent-ui** — AI-powered UI для coding-агентов
- **ClaudeBoard** — Real-time дашборд для Claude Code
- **codexboard** — Real-time дашборд для OpenAI Codex
- **swarm-tui** — TUI для управления coding-агентами

### 🔗 Интеграции
- **AgentHub** — Интеграция coding-агентов с внешними сервисами
- **ClaudeHub** — Интеграция Claude Code с GitHub
- **MCP-Hub** — Hub для MCP server интеграций

---

## 💡 Как использовать

### Для SMM Video / Clipos Studio:
1. **bernstein** — параллельные агенты для обработки видео + субтитров + постинга
2. **takopi** — Telegram-мост для управления агентами
3. **agentbox** — изоляция агентов в Docker
4. **sortie** — автоматизация из GitHub issues

### Быстрый старт:
```bash
# Установкаbernstein
git clone https://github.com/chernistry/bernstein
cd bernstein && make install

# Установка agentbox
git clone https://github.com/madarco/agentbox
cd agentbox && make install
```

---

*Последнее обновление: 2026-07-08*
