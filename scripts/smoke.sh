#!/usr/bin/env bash
#
# Дымовая проверка после выката (AI-35).
#
# Дёргает ключевые ручки живого прода и сравнивает коды ответов с ожидаемыми.
# Ничего не пишет и не требует секретов: смысл — поймать регрессию гейта
# авторизации в обе стороны. Именно такая ручная проверка нашла сломанную
# публикацию в Instagram/Threads, когда гейт закрыл /api/video-temp, по
# которому Meta забирает видео (тесты при этом были зелёные).
#
# Использование:
#   scripts/smoke.sh                     # прод, https://smm.nplanner.ru
#   scripts/smoke.sh http://host:5000    # любой другой инстанс
#
# Выход 0 — все проверки прошли; 1 — есть расхождения (перечислены в выводе).

set -u

BASE="${1:-${SMOKE_BASE_URL:-https://smm.nplanner.ru}}"
FAILED=0
PASSED=0

# check МЕТОД ПУТЬ ОЖИДАЕМЫЕ_КОДЫ ОПИСАНИЕ
# ОЖИДАЕМЫЕ_КОДЫ — через запятую, без пробелов: "200" или "400,404".
check() {
  local method="$1" path="$2" expected="$3" why="$4"
  local code
  code=$(curl -sS -m 20 -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" 2>/dev/null) || code="000"
  if [[ ",$expected," == *",$code,"* ]]; then
    PASSED=$((PASSED + 1))
    printf 'ok   %-4s %-55s %s  (%s)\n' "$method" "$path" "$code" "$why"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL %-4s %-55s %s, ожидалось %s  (%s)\n' "$method" "$path" "$code" "$expected" "$why"
  fi
}

# UUID, которого заведомо нет в temp-video-store: проверяем, что гейт пропускает
# сам ПУТЬ (иначе Meta не заберёт видео и публикация молча сломается), а 404
# отдаёт уже стор. 401 здесь — та самая регрессия.
NO_SUCH_UUID="00000000-0000-4000-8000-000000000000"

echo "Дымовая проверка $BASE"
echo

# --- живость ---
check GET  /health                                        200 "живость приложения"
check GET  /api/status-check                              200 "живость API"

# --- публичное: обязано отвечать без сессии ---
check GET  /api/config/pricing                            200 "публичная витрина цен"
check GET  /api/payments/available                        200 "кнопка онлайн-оплаты на тарифах"
check GET  /api/feature-flags                             200 "фичефлаги для клиента"
check GET  "/api/video-temp/$NO_SUCH_UUID"                404 "Meta забирает видео: гейт пропускает, 404 отдаёт стор"
check GET  /api/media-proxy/no-such-file                  400,404 "соцсети забирают медиа: не 401"

# --- защищённое: обязано отбивать без сессии ---
check GET  /api/campaigns                                 401 "гейт закрывает API"
check GET  /api/posts                                     401 "гейт закрывает API"
check POST "/api/video-temp/$NO_SUCH_UUID"                401 "video-temp публичен только на чтение"
check GET  /api/video-temp/not-a-uuid                     401 "video-temp публичен только по строгому UUID"

# --- вебхуки: без секрета не работают ---
check POST /api/trends/tg-webhook                         401,503 "коллбэк трендов требует секрет (503 = секрет не задан)"
check POST /api/trends/collect-trends-callback            401,503 "коллбэк трендов требует секрет"
check POST /api/webhook/trend-topics                      401 "наследство n8n, закрыто сознательно"

echo
if [[ $FAILED -gt 0 ]]; then
  echo "ПРОВАЛ: $FAILED из $((PASSED + FAILED)) проверок разошлись с ожиданиями."
  exit 1
fi
echo "OK: все $PASSED проверок прошли."
