#!/usr/bin/env bash
# Планка ошибок типизации сервера (AI-38, 21.08.2026).
#
# ЗАЧЕМ. `npm run check` смотрит СЕМЬ записей из tsconfig.critical.json и на
# остальной серверный код не смотрит вообще. Полная проверка
# (tsconfig.server-full.json) исторически красная, поэтому включить её как
# обычный шаг нельзя — она не станет зелёной за один заход. Планка не требует
# нуля: она запрещает РОСТ.
#
# ПОЧЕМУ В ПЛАНКЕ ХРАНИТСЯ ИМЯ КОНФИГУРАЦИИ. Первая версия хранила одно число.
# Запуск с другим конфигом считал ЕГО ошибки и сравнивал с той же планкой:
# на критическом конфиге получалось 0 против 388 и честный зелёный код.
# Порог, который обходится сменой входа, защищает не от роста, а от внимания.
# Теперь несовпадение конфигурации — отказ, а не зелёный прогон.
#
# ПОЧЕМУ ПЛАНКА НЕ ПОДНИМАЕТСЯ. `--update` записывает только то же самое или
# меньшее число. Иначе первый же красный прогон чинился бы не кодом, а
# «обновлением планки», и механизм тихо превратился бы в счётчик текущего
# состояния. Редкое осознанное повышение делается ручной правкой файла планки —
# отдельным коммитом, который видно в ревью.
#
# Коды выхода различают три разных исхода, потому что реагировать на них надо
# по-разному: 0 — норма, 1 — ошибок стало больше, 2 — прогон не состоялся
# (нет конфигурации, испорченная планка, tsc не запустился).
#
# Использование:
#   tsc-ratchet.sh              проверить (код 1 при росте)
#   tsc-ratchet.sh --report     только показать, при росте всё равно код 0
#   tsc-ratchet.sh --update     записать текущее число, если оно не больше планки
#
# Переменные окружения (ими же пользуется тест, проходя ТОТ ЖЕ путь, а не его
# пересказ): RATCHET_REPO, RATCHET_FILE, RATCHET_TSCONFIG, RATCHET_NPX.
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

# ── планка ───────────────────────────────────────────────────────────────────
# Формат строгий и целиком известный: ровно два поля, ничего кроме них.
# Незнакомое поле — это либо опечатка, либо чужой формат; и то и другое означает
# «я не знаю, с чем сравниваю», а такое сравнение делать нельзя.
BASE_CONFIG=""
BASE_COUNT=""

read_baseline() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    if [ "$key" = "$line" ]; then
      echo "Испорченная планка $BASELINE_FILE: строка без '=': $line" >&2
      exit 2
    fi
    case "$key" in
      config) BASE_CONFIG="$value" ;;
      count)  BASE_COUNT="$value" ;;
      *) echo "Испорченная планка $BASELINE_FILE: неизвестное поле '$key'" >&2; exit 2 ;;
    esac
  done < "$BASELINE_FILE"

  if [ -z "$BASE_CONFIG" ] || [ -z "$BASE_COUNT" ]; then
    echo "Испорченная планка $BASELINE_FILE: нужны оба поля config= и count=" >&2
    exit 2
  fi
  case "$BASE_COUNT" in
    ''|*[!0-9]*) echo "Испорченная планка $BASELINE_FILE: count='$BASE_COUNT' не число" >&2; exit 2 ;;
  esac
  if [ "$BASE_CONFIG" != "$TSCONFIG" ]; then
    echo "Планка снята конфигурацией '$BASE_CONFIG', а прогон идёт по '$TSCONFIG'." >&2
    echo "Сравнивать эти числа нельзя. Запустите по той же конфигурации." >&2
    exit 2
  fi
}

write_baseline() {
  printf 'config=%s\ncount=%s\n' "$TSCONFIG" "$1" > "$BASELINE_FILE"
}

if [ ! -f "$BASELINE_FILE" ]; then
  echo "Нет файла планки $BASELINE_FILE." >&2
  echo "Заведите его вручную: config=<конфигурация>, count=<число>." >&2
  exit 2
fi
read_baseline

# ── замер ────────────────────────────────────────────────────────────────────
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# tsc возвращает ненулевой код при любой ошибке типов — это ожидаемо, счёт
# ведём сами по строкам вывода.
set +e
"$NPX" tsc -p "$TSCONFIG" --noEmit > "$OUT" 2>&1
TSC_STATUS=$?
set -e

CURRENT="$(grep -c "error TS" "$OUT" || true)"

# Молчаливый ноль опаснее любого числа: упавший tsc выглядит как идеально
# чистый прогон. Признак — ошибок не найдено, но и осмысленного вывода нет,
# либо вывод говорит о несостоявшемся запуске.
if [ "$CURRENT" -eq 0 ]; then
  if [ "$TSC_STATUS" -ne 0 ] || grep -qiE "Cannot find|not found|ENOENT|command not found" "$OUT"; then
    echo "Проверка не выполнилась — вывод не похож на результат типизации (код tsc $TSC_STATUS):" >&2
    tail -20 "$OUT" >&2
    exit 2
  fi
fi

if [ "$MODE" = "update" ]; then
  if [ "$CURRENT" -gt "$BASE_COUNT" ]; then
    echo "Отказываюсь поднимать планку: сейчас $CURRENT, записано $BASE_COUNT." >&2
    echo "Планка только опускается. Почините новые ошибки; осознанное повышение —" >&2
    echo "ручная правка $BASELINE_FILE отдельным коммитом под ревью." >&2
    exit 2
  fi
  write_baseline "$CURRENT"
  echo "Планка записана: $CURRENT (конфигурация $TSCONFIG)"
  exit 0
fi

echo "Ошибок типизации сервера: $CURRENT (планка $BASE_COUNT, конфигурация $TSCONFIG)"

if [ "$CURRENT" -gt "$BASE_COUNT" ]; then
  echo
  echo "Стало больше на $((CURRENT - BASE_COUNT)). Файлы с наибольшим числом ошибок:"
  # awk вместо head: head закрывает конвейер досрочно, upstream получает SIGPIPE,
  # а под `set -o pipefail` это роняет скрипт кодом 141 вместо честного 1.
  grep "error TS" "$OUT" | cut -d'(' -f1 | sort | uniq -c | sort -rn | awk 'NR<=10'
  echo
  echo "Что делать: почините новые ошибки в своём изменении. Планка не поднимается."
  [ "$MODE" = "report" ] && { echo "(режим отчёта: не роняю прогон)"; exit 0; }
  exit 1
fi

if [ "$CURRENT" -lt "$BASE_COUNT" ]; then
  echo "Стало меньше на $((BASE_COUNT - CURRENT)). Опустите планку: scripts/tsc-ratchet.sh --update"
fi

exit 0
