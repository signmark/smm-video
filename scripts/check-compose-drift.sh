#!/usr/bin/env bash
# Сверяет копию compose в репозитории с боевым файлом.
#
# Зачем: /root/docker-compose.yml — то, по чему реально работает прод, а
# deploy/docker-compose.prod.yml — то, из чего поднимается новая установка.
# Два файла с одним смыслом расходятся молча, поэтому расхождение надо видеть,
# а не вспоминать о нём при переезде.
#
# Сравниваются только сервисы, нужные самому SMM Manager. Остальное в боевом
# файле (n8n, pgadmin, лендинг, ReelForge) в репозиторий не переносится.
#
# Выход: 0 — совпадает, 1 — есть расхождение, 2 — сравнить не удалось.
set -u

LIVE="${LIVE_COMPOSE:-/root/docker-compose.yml}"
REPO_FILE="$(dirname "$0")/../deploy/docker-compose.prod.yml"

if [ ! -f "$LIVE" ]; then
  echo "не с чем сравнивать: нет $LIVE (запускать на сервере, где живёт прод)"
  exit 2
fi
if [ ! -f "$REPO_FILE" ]; then
  echo "не с чем сравнивать: нет $REPO_FILE"
  exit 2
fi

SERVICES="traefik postgres directus-uploads-init directus smm video-app"

# Вырезает блок одного сервиса: от строки "  <имя>:" до следующего сервиса того
# же уровня. Комментарии и пустые строки убираются — они расходятся чаще всего
# и не меняют поведения.
extract() {
  awk -v svc="$2" '
    $0 ~ "^  " svc ":$" { inblock = 1; next }
    inblock && /^  [a-zA-Z0-9_-]+:$/ { inblock = 0 }
    inblock && /^networks:$/ { inblock = 0 }
    inblock { print }
  ' "$1" | sed -e 's/#.*$//' -e 's/[[:space:]]*$//' -e '/^$/d'
}

drift=0
for svc in $SERVICES; do
  if ! diff -u <(extract "$LIVE" "$svc") <(extract "$REPO_FILE" "$svc") > "/tmp/compose-drift-$svc.diff" 2>&1; then
    echo "--- расхождение в сервисе $svc"
    sed -n '1,40p' "/tmp/compose-drift-$svc.diff"
    drift=1
  fi
done

if [ "$drift" = 0 ]; then
  echo "совпадает: боевой файл и копия в репозитории описывают сервисы одинаково"
else
  echo
  echo "Расхождение — не ошибка само по себе, но копия в репозитории должна"
  echo "описывать то же, что работает на проде. Поправьте ту сторону, которая отстала."
fi
exit $drift
