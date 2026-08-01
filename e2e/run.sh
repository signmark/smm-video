#!/usr/bin/env bash
#
# Прогон E2E против стенда. Прод не участвует.
#
# Лежит в репозитории намеренно: раньше раннер жил как /root/run-e2e.sh вне
# версий, и правка в нём не переживала бы ни ревью, ни перенос на другой хост.
set -Eeuo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${PLAYWRIGHT_BASE_URL:=http://127.0.0.1:5100}"
: "${TEST_EMAIL:=e2e-user@example.com}"
: "${TEST_PASSWORD:=e2e-user-password}"
: "${PLAYWRIGHT_WORKERS:=3}"
: "${PLAYWRIGHT_TIMEOUT:=45000}"
export PLAYWRIGHT_BASE_URL TEST_EMAIL TEST_PASSWORD PLAYWRIGHT_WORKERS PLAYWRIGHT_TIMEOUT

# Браузер под текущую версию пакета. Идемпотентно: если сборка есть — секунды.
# Без этого шага рассинхрон версий воспроизводится молча (AI-61).
npm run e2e:install

exec npx playwright test "$@"
