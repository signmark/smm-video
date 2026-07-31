#!/usr/bin/env bash
#
# Канонический деплой smm. Единственный поддерживаемый способ выкатить прод.
#
# Зачем скрипт, а не пара команд руками (AI-50)
# ---------------------------------------------
# На проде одновременно работают несколько исполнителей (агенты Raft, Claude
# Desktop, человек). Общий ресурс ровно один — тег образа и контейнер `smm`.
# Правки при этом могут не пересекаться вовсе: ломается не содержимое, а
# порядок. Кто собрал и переключил последним, того версия остаётся на проде.
# 31.07.2026 две сборки шли параллельно; обошлось только потому, что вторая
# успела подтянуть актуальный main. Собери она на 20 минут раньше — уже влитый
# security-фикс молча исчез бы с прода, и заметить это можно было бы лишь
# грепом по бандлу.
#
# Отсюда три инварианта, ради которых всё написано:
#
#  1. build + переключение контейнера — сериализованная транзакция (host-wide
#     flock от fetch до проверки). Параллельно не строим.
#  2. Устаревшая сборка не может заменить более новый main: после долгой сборки
#     origin/main перечитывается, и при расхождении переключение НЕ делается.
#  3. Контекст сборки — временный worktree ровно на SHA, никогда `/root/smm`.
#     Docker берёт контекст из рабочего дерева, а не из HEAD: сборка из общего
#     каталога унесёт в прод чужие незакоммиченные файлы.
#
# Плюс provenance: SHA зашит в образ (label + ENV) и виден в /health, поэтому
# «уехал ли код» проверяется полем, а не грепом ASCII-маркеров по бандлу.
#
# Тестируемость: все внешние команды и пути берутся из переменных окружения
# (SMM_DOCKER, SMM_GIT, SMM_CURL, SMM_REPO_DIR, ...). Тест подменяет их
# фейками и гоняет два процесса на временном репозитории — боевой контейнер в
# проверке гонки не участвует.
#
# Использование:
#   scripts/deploy-smm.sh                 # выкатить текущий origin/main
#   scripts/deploy-smm.sh --rollback SHA  # вернуться на ранее собранный SHA
#   scripts/deploy-smm.sh --dry-run       # всё кроме build/переключения
#
# Коды возврата:
#   0  — выкачено и проверено
#   75 — retryable: origin/main уехал во время сборки, ничего не переключено
#   1  — ошибка; при сбое после переключения выполнен откат

set -Eeuo pipefail

# --- настраиваемое окружение (в проде значения по умолчанию) ---------------
SMM_REPO_DIR="${SMM_REPO_DIR:-/root/smm}"
SMM_COMPOSE_FILE="${SMM_COMPOSE_FILE:-/root/docker-compose.yml}"
SMM_LOCK_FILE="${SMM_LOCK_FILE:-/var/lock/smm-deploy.lock}"
SMM_WORKTREE_BASE="${SMM_WORKTREE_BASE:-/root/.smm-deploy-worktrees}"
SMM_IMAGE_REPO="${SMM_IMAGE_REPO:-root-smm}"
SMM_DEPLOYED_TAG="${SMM_DEPLOYED_TAG:-${SMM_IMAGE_REPO}:deployed}"
SMM_SERVICE="${SMM_SERVICE:-smm}"
# Имя контейнера отдельно от имени сервиса: в проде они совпадают
# (container_name: smm), но полагаться на совпадение нельзя — docker inspect
# ищет контейнер, а не сервис compose.
SMM_CONTAINER="${SMM_CONTAINER:-$SMM_SERVICE}"
SMM_HEALTH_URL="${SMM_HEALTH_URL:-https://smm.nplanner.ru/health}"
SMM_PUBLIC_URL="${SMM_PUBLIC_URL:-https://smm.nplanner.ru/}"
SMM_LOCK_WAIT="${SMM_LOCK_WAIT:-1800}"
SMM_HEALTH_RETRIES="${SMM_HEALTH_RETRIES:-30}"
SMM_HEALTH_DELAY="${SMM_HEALTH_DELAY:-2}"
# Сколько последних root-smm:<sha> держать для отката. Каждый образ — ~2.4 ГБ
# УНИКАЛЬНЫХ слоёв, поэтому «держать десять» физически не помещается на диск
# (AI-51). Три — это откат примерно на сутки деплоев.
SMM_KEEP_IMAGES="${SMM_KEEP_IMAGES:-3}"
# Ниже этого порога свободного места не начинаем сборку: упасть на середине
# из-за места хуже, чем честно отказаться сразу. Сборке нужно ~3.4 ГБ.
SMM_MIN_FREE_MB="${SMM_MIN_FREE_MB:-8000}"
SMM_DOCKER_ROOT="${SMM_DOCKER_ROOT:-/var/lib/docker}"

SMM_DOCKER="${SMM_DOCKER:-docker}"
SMM_GIT="${SMM_GIT:-git}"
SMM_CURL="${SMM_CURL:-curl}"
SMM_DF="${SMM_DF:-df}"

# Куда писать машиночитаемый журнал шагов. Тест по нему проверяет, что
# critical section двух процессов не пересеклись.
SMM_EVENT_LOG="${SMM_EVENT_LOG:-}"

MODE="deploy"
ROLLBACK_SHA=""
DRY_RUN="no"

log()  { printf '[deploy-smm] %s\n' "$*" >&2; }
fail() { log "ОШИБКА: $*"; exit 1; }

# Событие в журнал: одна строка «метка<TAB>pid<TAB>время<TAB>детали».
# Время в наносекундах — тесту нужно сравнивать интервалы, а не порядок строк.
event() {
  [ -n "$SMM_EVENT_LOG" ] || return 0
  printf '%s\t%s\t%s\t%s\n' "$1" "$$" "$(date +%s%N)" "${2:-}" >>"$SMM_EVENT_LOG"
}

usage() {
  sed -n '3,40p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --rollback)
      MODE="rollback"
      ROLLBACK_SHA="${2:-}"
      [ -n "$ROLLBACK_SHA" ] || fail "--rollback требует SHA"
      shift 2
      ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    -h|--help) usage 0 ;;
    *) fail "неизвестный аргумент: $1 (см. --help)" ;;
  esac
done

# --- preflight: compose не должен уметь собирать образ ---------------------
#
# Пока у сервиса `smm` есть секция build:, обычный `docker compose up` соберёт
# его из рабочего каталога — ровно тот footgun, ради которого всё затевалось.
# Проверяем на effective config (после подстановки .env и override-файлов), а
# не грепом по исходному yml.
preflight_compose() {
  local cfg
  cfg="$("$SMM_DOCKER" compose -f "$SMM_COMPOSE_FILE" config 2>/dev/null)" \
    || fail "не удалось прочитать compose config: $SMM_COMPOSE_FILE"

  # Вырезаем блок сервиса: от строки "  <service>:" до следующего сервиса того
  # же уровня. Отступ в выводе `docker compose config` нормализован, поэтому
  # два пробела — надёжный признак уровня, а не догадка о форматировании.
  local block
  block="$(printf '%s\n' "$cfg" | sed -n "/^  ${SMM_SERVICE}:\$/,/^  [a-zA-Z0-9_-]*:\$/p" \
    | sed "1d;\$d")"

  [ -n "$block" ] || fail "сервис $SMM_SERVICE не найден в compose config"

  if printf '%s\n' "$block" | grep -qE '^\s+build:'; then
    fail "у сервиса $SMM_SERVICE осталась секция build: — compose сможет собрать образ из рабочего каталога. Убрать build:, оставить только image: $SMM_DEPLOYED_TAG"
  fi

  local image
  image="$(printf '%s\n' "$block" | awk '/^[[:space:]]+image:/ {print $2; exit}')"
  [ "$image" = "$SMM_DEPLOYED_TAG" ] \
    || fail "сервис $SMM_SERVICE указывает image: '${image:-<нет>}', ожидается '$SMM_DEPLOYED_TAG'"

  event preflight_ok "$image"
}

# --- рабочая часть, целиком под локом --------------------------------------
CREATED_WORKTREE=""
PREV_IMAGE_ID=""
SWITCHED="no"

cleanup() {
  local rc=$?
  # Освобождение лока фиксируем здесь, а не в конце main: выход бывает и
  # аварийным, и retryable (75). Тест сверяет по журналу, что critical section
  # двух процессов не пересеклись, и пропуск события сломал бы именно её.
  event lock_released "rc=$rc"
  # Удаляем ТОЛЬКО свой временный worktree. Чужие и постоянные не трогаем.
  if [ -n "$CREATED_WORKTREE" ] && [ -d "$CREATED_WORKTREE" ]; then
    "$SMM_GIT" -C "$SMM_REPO_DIR" worktree remove --force "$CREATED_WORKTREE" >/dev/null 2>&1 \
      || rm -rf "$CREATED_WORKTREE"
    event worktree_removed "$CREATED_WORKTREE"
  fi
  return $rc
}
trap cleanup EXIT

# Откат к предыдущему образу: алиас обратно и пересоздание контейнера.
rollback_alias() {
  [ -n "$PREV_IMAGE_ID" ] || { log "откатывать не к чему: предыдущий образ неизвестен"; return 0; }
  log "откат: возвращаю $SMM_DEPLOYED_TAG на $PREV_IMAGE_ID"
  event rollback_start "$PREV_IMAGE_ID"
  "$SMM_DOCKER" tag "$PREV_IMAGE_ID" "$SMM_DEPLOYED_TAG" || return 1
  "$SMM_DOCKER" compose -f "$SMM_COMPOSE_FILE" up -d --no-build --no-deps --force-recreate "$SMM_SERVICE" || return 1
  event rollback_done "$PREV_IMAGE_ID"
}

# Свободного места хватит на сборку?
#
# Диск на этом хосте общий с postgres, directus, traefik и n8n: заполнив его,
# мы уроним не только smm. Поэтому отказ до сборки, а не «а вдруг влезет».
check_free_space() {
  # `|| true` обязателен. Под `set -Eeuo pipefail` падение df роняет весь
  # pipeline, подстановка возвращает ненулевой код, и `set -e` убивает скрипт
  # ДО проверки ниже — то есть ветка «не смог измерить, продолжаю» была
  # недостижима в принципе. На машине без $SMM_DOCKER_ROOT (любой dev-хост)
  # это делало обязательный прогон тестов невыполнимым, а на проде при
  # недоступном docker root деплой падал бы молча вместо деградации.
  local avail
  avail="$( { "$SMM_DF" -Pm "$SMM_DOCKER_ROOT" 2>/dev/null | awk 'NR==2 {print $4}'; } || true )"
  if [ -z "$avail" ]; then
    log "не удалось определить свободное место на $SMM_DOCKER_ROOT — продолжаю без проверки"
    event free_space_unknown
    return 0
  fi
  event free_space "$avail"
  [ "$avail" -ge "$SMM_MIN_FREE_MB" ] \
    || fail "свободно ${avail} МБ на $SMM_DOCKER_ROOT, нужно минимум ${SMM_MIN_FREE_MB} МБ. Освободите место (см. AI-51) или снизьте SMM_MIN_FREE_MB осознанно."
}

# Ротация старых образов сборки.
#
# Удаляются ТОЛЬКО теги вида <repo>:<40 hex>, то есть автоматические сборки.
# Не трогаются: алиас deployed, образ запущенного контейнера и любые
# человеческие метки вроде pre-ai50-<sha> или latest — они ставятся руками
# как точки отката, и снести их автоматикой недопустимо.
#
# Общий `docker system prune` здесь неприменим принципиально: он бьёт по всему
# хосту, включая чужие сервисы и их volume'ы. Удаляем точечно, по списку.
prune_old_images() {
  local deployed_id container_id
  deployed_id="$("$SMM_DOCKER" image inspect --format '{{.Id}}' "$SMM_DEPLOYED_TAG" 2>/dev/null || true)"
  container_id="$("$SMM_DOCKER" inspect --format '{{.Image}}' "$SMM_CONTAINER" 2>/dev/null || true)"

  local kept=0 tag id removed=0
  # docker images выдаёт от новых к старым
  while read -r tag id; do
    [ -n "$tag" ] || continue
    case "$tag" in
      *[!0-9a-f]* | "") continue ;;                 # не полный SHA — не наш автотег
    esac
    [ "${#tag}" -eq 40 ] || continue

    if [ "$kept" -lt "$SMM_KEEP_IMAGES" ]; then
      kept=$((kept + 1))
      continue
    fi
    # Сравниваем полные id с полными. `docker images` без --no-trunc отдаёт
    # короткий id (12 hex), а `image inspect` — `sha256:<64>`: ни одна форма
    # сравнения не совпадала бы никогда, и защита была бы мёртвым кодом.
    [ -n "$deployed_id" ] && [ "$id" = "$deployed_id" ] && continue
    [ -n "$container_id" ] && [ "$id" = "$container_id" ] && continue

    if "$SMM_DOCKER" image rm "${SMM_IMAGE_REPO}:${tag}" >/dev/null 2>&1; then
      removed=$((removed + 1))
      log "убран старый образ ${SMM_IMAGE_REPO}:${tag}"
    fi
  done <<EOF
$("$SMM_DOCKER" images "$SMM_IMAGE_REPO" --no-trunc --format '{{.Tag}} {{.ID}}' 2>/dev/null)
EOF

  event pruned "kept=$kept removed=$removed"
  [ "$removed" -gt 0 ] && log "ротация: оставлено $kept, удалено $removed"
  return 0
}

verify_revision() {
  local sha="$1" where value
  # 1. label самого образа
  value="$("$SMM_DOCKER" image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$SMM_DEPLOYED_TAG" 2>/dev/null || true)"
  [ "$value" = "$sha" ] || { log "revision образа: '$value' != '$sha'"; return 1; }

  # 2. образ запущенного контейнера
  value="$("$SMM_DOCKER" inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$SMM_CONTAINER" 2>/dev/null || true)"
  [ "$value" = "$sha" ] || { log "revision контейнера: '$value' != '$sha'"; return 1; }

  # 3. то, что приложение само о себе сообщает
  local body attempt=0
  while [ "$attempt" -lt "$SMM_HEALTH_RETRIES" ]; do
    body="$("$SMM_CURL" -s --max-time 10 "$SMM_HEALTH_URL" 2>/dev/null || true)"
    value="$(printf '%s' "$body" | sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ "$value" = "$sha" ] && { event verify_ok "$sha"; return 0; }
    attempt=$((attempt + 1))
    sleep "$SMM_HEALTH_DELAY"
  done
  log "/health.revision: '$value' != '$sha' после $SMM_HEALTH_RETRIES попыток"
  return 1
}

switch_and_verify() {
  local sha="$1" image="$2"

  PREV_IMAGE_ID="$("$SMM_DOCKER" image inspect --format '{{.Id}}' "$SMM_DEPLOYED_TAG" 2>/dev/null || true)"
  event prev_image "$PREV_IMAGE_ID"

  log "переключаю $SMM_DEPLOYED_TAG -> $image"
  "$SMM_DOCKER" tag "$image" "$SMM_DEPLOYED_TAG" || fail "не удалось переставить алиас"
  SWITCHED="yes"
  event alias_switched "$sha"

  event up_start "$sha"
  if ! "$SMM_DOCKER" compose -f "$SMM_COMPOSE_FILE" up -d --no-build --no-deps --force-recreate "$SMM_SERVICE"; then
    log "up не удался — откатываюсь"
    rollback_alias || log "откат тоже не удался, нужно вмешательство"
    exit 1
  fi
  event up_done "$sha"

  if ! verify_revision "$sha"; then
    log "проверка provenance не прошла — откатываюсь"
    rollback_alias || log "откат тоже не удался, нужно вмешательство"
    exit 1
  fi

  # Публичный URL — последняя проверка: контейнер может подняться, но не
  # отвечать наружу (traefik, сертификат).
  local code
  code="$("$SMM_CURL" -s -o /dev/null -w '%{http_code}' --max-time 15 "$SMM_PUBLIC_URL" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] || { log "публичный URL отдал $code"; rollback_alias || true; exit 1; }
  event public_ok "$code"
}

do_rollback() {
  local sha="$1"
  local image="${SMM_IMAGE_REPO}:${sha}"

  # Короткий SHA принимается, но разворачивается в полный: теги ставятся
  # полными, а человек обычно копирует первые 7-12 символов из git log.
  # Неоднозначный префикс — это отказ, а не «возьмём первый попавшийся».
  if ! "$SMM_DOCKER" image inspect "$image" >/dev/null 2>&1; then
    local matches
    matches="$("$SMM_DOCKER" images "$SMM_IMAGE_REPO" --format '{{.Tag}}' 2>/dev/null \
      | grep -E "^${sha}[0-9a-f]*$" || true)"
    local count
    count="$(printf '%s\n' "$matches" | grep -c . || true)"
    if [ "$count" = "1" ]; then
      sha="$(printf '%s\n' "$matches" | head -1)"
      image="${SMM_IMAGE_REPO}:${sha}"
      log "короткий SHA развёрнут в $sha"
    elif [ "${count:-0}" -gt 1 ]; then
      fail "префикс $1 неоднозначен, подходит несколько образов: $(printf '%s ' $matches)"
    fi
  fi

  "$SMM_DOCKER" image inspect "$image" >/dev/null 2>&1 \
    || fail "образ $image не найден: откатываться некуда"
  log "откат на $image"
  switch_and_verify "$sha" "$image"
  log "откат на $sha выполнен"
}

do_deploy() {
  event fetch_start
  "$SMM_GIT" -C "$SMM_REPO_DIR" fetch origin --prune >/dev/null 2>&1 \
    || fail "git fetch не удался"
  local sha
  sha="$("$SMM_GIT" -C "$SMM_REPO_DIR" rev-parse origin/main)" || fail "не удалось прочитать origin/main"
  event fetch_done "$sha"
  log "целевой SHA: $sha"

  local image="${SMM_IMAGE_REPO}:${sha}"

  # Чистый контекст: отдельный detached worktree ровно на этом SHA.
  mkdir -p "$SMM_WORKTREE_BASE"
  CREATED_WORKTREE="${SMM_WORKTREE_BASE}/${sha}.$$"
  "$SMM_GIT" -C "$SMM_REPO_DIR" worktree add --detach "$CREATED_WORKTREE" "$sha" >/dev/null 2>&1 \
    || fail "не удалось создать worktree на $sha"
  event worktree_created "$CREATED_WORKTREE"

  local dirty
  dirty="$("$SMM_GIT" -C "$CREATED_WORKTREE" status --porcelain)"
  [ -z "$dirty" ] || fail "worktree сборки не чист — это не должно случаться: $dirty"

  if [ "$DRY_RUN" = "yes" ]; then
    log "--dry-run: сборка и переключение пропущены (SHA $sha, контекст $CREATED_WORKTREE)"
    event dry_run_done "$sha"
    return 0
  fi

  check_free_space

  event build_start "$sha"
  "$SMM_DOCKER" build \
    --build-arg "APP_COMMIT_SHA=$sha" \
    --label "org.opencontainers.image.revision=$sha" \
    -t "$image" \
    -f "${CREATED_WORKTREE}/Dockerfile" \
    "$CREATED_WORKTREE" || fail "сборка не удалась"
  event build_done "$sha"

  # Сборка длинная. За это время main мог уехать вперёд — тогда наш образ уже
  # устарел, и переключаться на него нельзя: это и есть тот самый молчаливый
  # откат чужой работы. Образ оставляем: он пригодится для диагностики.
  "$SMM_GIT" -C "$SMM_REPO_DIR" fetch origin --prune >/dev/null 2>&1 || fail "повторный git fetch не удался"
  local now
  now="$("$SMM_GIT" -C "$SMM_REPO_DIR" rev-parse origin/main)"
  event recheck "$now"
  if [ "$now" != "$sha" ]; then
    log "origin/main уехал за время сборки: $sha -> $now. Контейнер НЕ переключаю."
    log "образ $image оставлен для диагностики; запустите деплой заново."
    event stale_abort "$sha->$now"
    exit 75
  fi

  switch_and_verify "$sha" "$image"
  log "выкачено: $sha"

  # Только после успешной проверки прода: неудачный деплой не должен
  # ничего удалять — старые образы это и есть пути отката.
  prune_old_images
}

main() {
  preflight_compose

  if [ "$MODE" = "rollback" ]; then
    do_rollback "$ROLLBACK_SHA"
  else
    do_deploy
  fi
}

# --- сериализация ----------------------------------------------------------
# Лок держится от fetch до проверки прода включительно. Второй процесс ждёт и
# сообщает об этом, но НЕ строит параллельно.
mkdir -p "$(dirname "$SMM_LOCK_FILE")" 2>/dev/null || true
exec 9>"$SMM_LOCK_FILE" || fail "не удалось открыть лок-файл $SMM_LOCK_FILE"

if ! flock -n 9; then
  log "другой деплой уже идёт — жду освобождения (до ${SMM_LOCK_WAIT}s)"
  event lock_wait
  flock -w "$SMM_LOCK_WAIT" 9 || fail "не дождался лока за ${SMM_LOCK_WAIT}s"
fi
event lock_acquired
log "лок получен"

main
