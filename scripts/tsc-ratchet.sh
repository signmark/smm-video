#!/usr/bin/env bash
# Планка типизации сервера (AI-38, 21.08.2026).
#
# ЗАЧЕМ. `npm run check` смотрит СЕМЬ записей из tsconfig.critical.json и на
# остальной серверный код не смотрит вообще. Полная проверка
# (tsconfig.server-full.json) исторически красная, поэтому включить её как
# обычный шаг нельзя — она никогда не станет зелёной за один заход. Планка
# решает это иначе: она не требует нуля, она запрещает РОСТ. Число ошибок
# зафиксировано в файле рядом; прогон падает, если стало больше, и предлагает
# опустить планку, если стало меньше.
#
# ПОЧЕМУ ЭТО НУЖНО ИМЕННО СЕЙЧАС. Планка 388 была снята с main, когда заводился
# тикет. Замер 21.08 на `22b2c652d` дал 406. Без гейта число растёт молча —
# восемнадцать новых ошибок никто не заметил.
#
# Использование:
#   tsc-ratchet.sh              проверить (падает при росте)
#   tsc-ratchet.sh --report     только показать, никогда не падать
#   tsc-ratchet.sh --update     записать текущее число как новую планку
#
# Переменные окружения (для временного репозитория в тестах — тот же путь, а не
# его пересказ): RATCHET_REPO, RATCHET_FILE, RATCHET_TSCONFIG, RATCHET_NPX.
set -euo pipefail

REPO="${RATCHET_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TSCONFIG="${RATCHET_TSCONFIG:-tsconfig.server-full.json}"
BASELINE_FILE="${RATCHET_FILE:-$REPO/scripts/tsc-ratchet.baseline}"
NPX="${RATCHET_NPX:-npx}"

MODE="check"
case "${1:-}" in
  --report) MODE="report" ;;
  --update) MODE="update" ;;
  "") ;;
  *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
esac

cd "$REPO"

if [ ! -f "$TSCONFIG" ]; then
  echo "Нет файла конфигурации $TSCONFIG в $REPO" >&2
  exit 2
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# tsc возвращает ненулевой код при любой ошибке — это ожидаемо, счёт ведём сами.
set +e
"$NPX" tsc -p "$TSCONFIG" --noEmit > "$OUT" 2>&1
set -e

CURRENT="$(grep -c "error TS" "$OUT" || true)"

# Признак того, что упал сам tsc, а не типизация: ошибок не найдено, но и
# осмысленного вывода нет. Молчаливый ноль здесь опаснее любого числа —
# он выглядит как идеально чистый прогон.
if [ "$CURRENT" -eq 0 ] && grep -qiE "error TS[0-9]+|Cannot find|not found|ENOENT" "$OUT"; then
  echo "Проверка не выполнилась — вывод tsc не похож на результат типизации:" >&2
  tail -20 "$OUT" >&2
  exit 2
fi

if [ "$MODE" = "update" ]; then
  echo "$CURRENT" > "$BASELINE_FILE"
  echo "Планка записана: $CURRENT (конфигурация $TSCONFIG)"
  exit 0
fi

if [ ! -f "$BASELINE_FILE" ]; then
  echo "Нет файла планки $BASELINE_FILE. Запустите с --update, чтобы зафиксировать текущее число." >&2
  exit 2
fi

BASELINE="$(tr -dc '0-9' < "$BASELINE_FILE")"
if [ -z "$BASELINE" ]; then
  echo "Файл планки $BASELINE_FILE не содержит числа." >&2
  exit 2
fi

echo "Ошибок типизации сервера: $CURRENT (планка $BASELINE, конфигурация $TSCONFIG)"

if [ "$CURRENT" -gt "$BASELINE" ]; then
  echo
  echo "Стало больше на $((CURRENT - BASELINE)). Файлы с наибольшим числом ошибок:"
  # awk вместо head: head закрывает конвейер досрочно, upstream получает SIGPIPE,
  # а под `set -o pipefail` это роняет весь скрипт кодом 141 вместо честного 1.
  grep "error TS" "$OUT" | cut -d'(' -f1 | sort | uniq -c | sort -rn | awk "NR<=10"
  echo
  echo "Что делать: почините новые ошибки в своём изменении."
  echo "Планку поднимать нельзя — она только опускается."
  [ "$MODE" = "report" ] && { echo "(режим отчёта: не роняю прогон)"; exit 0; }
  exit 1
fi

if [ "$CURRENT" -lt "$BASELINE" ]; then
  echo "Стало меньше на $((BASELINE - CURRENT)). Опустите планку: scripts/tsc-ratchet.sh --update"
fi

exit 0
