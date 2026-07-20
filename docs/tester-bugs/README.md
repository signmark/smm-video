# Tester bugs tracker

Источник: Google Sheet «ТЕСТ Omemo Tech»
(`1G7w_7pqtlF9uXDFEc0bkH5HACbWvX38sn5eCPp-B9no`), баги от тестеров
Михайло и Дарья. Этот документ — Mavis'овский state для отслеживания
багов и автоматической перекрёстной проверки с git.

## Файлы

- `state.json` — машинно-читаемое состояние всех известных багов
  (sheet_row, status, fix_commits из git, mavis_status, sheet_actions_pending)
- `README.md` — этот файл (схема и процесс)

## Workflow

1. **Poll sheet (read-only, API key)** — каждые N минут, обновляю
   `last_sheet_sync` и список bugs в `state.json` если в листе
   появились новые/изменились существующие.
2. **Cross-check git** — для каждого open bug ищу `git log` по
   ключевым словам из title/section. Если нахожу fix-коммиты —
   проставляю `fix_commits[]` и `mavis_status: fix_in_git_*`.
3. **Update sheet (write, requires Service Account)** — для багов
   с `mavis_status: fix_in_git_awaiting_retest` применяю:
   - `H = "Тестировщик"`
   - `backgroundColor = R0-G255-B0` на всю строку A:L
4. **Закрытие** — когда тестер подтвердил fix (L = "Исправлено"),
   предлагаю `H = "FIXED"`, отмечаю в `closed_bugs_seen[]`.

## mavis_status таксономия

| Статус | Значение |
|---|---|
| `open` | fix в git не найден, в работе у dev или у тестера |
| `open_wip_by_dev` | dev в комментах подтвердил что в работе, не закрыт |
| `fix_in_git_awaiting_retest` | fix найден, нужно отметить в листе + ждать ретест |
| `fix_in_git_ux_concern_not_bug` | fix частичный, dev считает UX-вопросом |
| `fix_in_git_question_for_tester` | fix есть, но dev в комментах задал уточняющий вопрос тестеру |
| `fix_retest_passed_awaiting_status_sync` | L="Исправлено", H не обновлён |
| `partial_fix_in_git_new_task_needed` | фикс частичный, нужен новый Codex-таск |
| `by_design_per_dev_comment` | dev в комментах сказал что by design |
| `deferred_post_stabilization` | dev policy: отложено до стабилизации релиза |
| `wont_fix` | dev policy: won't fix / ограничение платформы |

## Зачем это всё

- **Один источник правды по состоянию багов** (master — git, sheet
  вторичен и часто stale)
- **Cross-verify**: если тестер пометил баг как «открыт», но в git
  уже есть fix-коммит — Mavis флагирует и предлагает ретест
- **Не теряем контекст между циклами**: state.json коммитится в
  репо, история изменений в git
- **Закрыто = закоммичено**: каждый status transition фиксируется
  в git с понятным diff

## Чего Mavis НЕ делает

- Не лезет в прод-код (`server/`, `client/`, `shared/`)
- Не придумывает fix'ы — только ищет существующие в git
- Не закрывает баги в листе без явного подтверждения от тестера
  (L = "Исправлено")
- Не пишет в лист пока нет Service Account (Google блокирует
  writes по API key)
