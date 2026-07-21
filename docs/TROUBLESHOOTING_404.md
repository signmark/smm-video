# Исправление 404: Directus и SMM

## Краткое резюме

У вас **две отдельные проблемы**:

1. **Directus 404** — SMM не может достучаться до Directus (коллекции или конфигурация)
2. **smm.omemo.tech 404** — главная страница не открывается (маршрутизация или статика)

Контейнер SMM **не падает** — сервер успешно стартует на порту 5000. Ошибки связаны с доступом к Directus и маршрутизацией.

---

## Проблема 1: Directus 404

### Симптомы в логах

```
[directus-crud] list telegram_sessions failed (attempt 1/4): Request failed with status code 404
Ошибка обновления кэша API ключей: Request failed with status code 404
[directus-crud] list campaign_content failed (attempt 1/4): Request failed with status code 404
```

### Причины

**A) `DIRECTUS_DB_PASSWORD` не задан**

```
WARN[0000] The "DIRECTUS_DB_PASSWORD" variable is not set. Defaulting to a blank string.
```

При пустом пароле Directus не подключается к PostgreSQL, схема может не инициализироваться.

**Что сделать:**

В `docker-compose.yml` добавлен fallback: если `DIRECTUS_DB_PASSWORD` не задан, используется `POSTGRES_PASSWORD`. Убедитесь, что хотя бы `POSTGRES_PASSWORD` задан в `.env`:

```env
POSTGRES_PASSWORD=QtpZ3dh7
# Опционально, если нужен отдельный пароль для Directus:
# DIRECTUS_DB_PASSWORD=QtpZ3dh7
```

2. Убедитесь, что база `directus` создана в PostgreSQL (часто создаётся автоматически при первом старте Directus).

**B) Коллекции Directus не существуют**

404 для `/items/telegram_sessions` и `/items/campaign_content` обычно означает, что таких коллекций нет.

Нужно создать коллекции и схему, которые ожидает SMM (например, через миграции или импорт схемы из рабочего инстанса).

**Проверка доступности Directus:**

```bash
# Проверка, отвечает ли Directus
curl -s https://directus.nplanner.ru/server/info

# Проверка коллекций (с токеном)
curl -s -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  https://directus.nplanner.ru/collections
```

Если `/server/info` возвращает 404, Directus не настроен или не доступен на этом домене.

**C) Несоответствие домена Directus**

- SMM использует `DIRECTUS_URL=https://directus.nplanner.ru` (из `.env`)
- DNS `directus.nplanner.ru` должен указывать на ваш сервер
- В Traefik для Directus должно быть правило `Host(directus.nplanner.ru)`

---

## Проблема 2: smm.omemo.tech 404

### Симптомы

В браузере — стандартная «404 page not found».

### Возможные причины

**A) Traefik не находит backend**

Проверьте, что контейнеры в одной сети и что у SMM есть корректные labels Traefik.

В вашем `docker-compose.yml`:

```yaml
smm:
  labels:
    - traefik.enable=true
    - traefik.http.routers.smm.rule=Host(`smm.omemo.tech`)
    - traefik.http.routers.smm.tls=true
    - traefik.http.routers.smm.entrypoints=web,websecure
    - traefik.http.services.smm.loadbalancer.server.port=5000
```

**B) Сеть Docker (КРИТИЧНО)**

Traefik и все бэкенды должны быть в одной сети `proxy`. Traefik должен знать, в какой сети искать контейнеры:

```yaml
# В command Traefik:
- "--providers.docker.network=proxy"

# Каждый сервис с Traefik labels:
networks:
  - proxy
labels:
  - traefik.docker.network=proxy
```

Без этого Traefik возвращает "404 page not found" для всех запросов.

**C) Healthcheck SMM**

В логах сервер запускается успешно:

```
=== SERVER SUCCESSFULLY STARTED ON PORT 5000 ===
```

Проверьте, отвечает ли `/health`:

```bash
# С хоста (если порт 5000 проброшен)
curl http://localhost:5000/health

# Или из контейнера smm
docker exec root-smm-1 curl -s http://localhost:5000/health
```

**D) Отсутствует index.html**

SMM раздаёт SPA из `dist/public`. Если при сборке фронтенд не попадает в образ, возможна 404.

В логах видно:

```
DEBUG: distPath FOUND: /app/dist/public
```

Значит каталог есть, но сборка Docker могла использоваться из другого контекста (например, `./smm` без полного проекта).

---

## Чек-лист исправлений

### Шаг 1: Directus

- [ ] Добавить `DIRECTUS_DB_PASSWORD` в `.env`
- [ ] Перезапустить Directus:
  ```bash
  docker-compose up -d directus
  ```
- [ ] Проверить, что Directus доступен:
  ```bash
  curl -s https://directus.nplanner.ru/server/info
  ```
- [ ] В админке Directus создать коллекции (если их нет): `telegram_sessions`, `campaign_content`, `api_keys` и др., которые использует SMM

### Шаг 2: Сеть и маршрутизация

- [ ] Убедиться, что Traefik и SMM в одной сети
 - [ ] **Полное пересоздание** (чтобы применить правки docker-compose):
  ```bash
  cd /root/smm   # или где лежит ваш docker-compose
  docker-compose down
  docker-compose up -d
  ```
- [ ] Если используете **Coolify** — проверьте, не конфликтует ли он с Traefik на 80/443

### Шаг 3: Сборка SMM

- [ ] Убедиться, что `build` в docker-compose указывает на корень проекта, где есть `client/`, `server/`, `vite.config.ts`
- [ ] Пересобрать образ SMM:
  ```bash
  docker-compose build --no-cache smm && docker-compose up -d smm
  ```

### Шаг 4: Переменные окружения

Проверьте, что в `.env` (или передаваемом в compose) заданы:

```env
DIRECTUS_URL=https://directus.nplanner.ru
DIRECTUS_DB_PASSWORD=QtpZ3dh7   # <- обязательно
DIRECTUS_ADMIN_TOKEN=2bexIeLQqichfy3KseO3V31XDxfY-zP5
# и т.д.
```

---

## Контекст сборки SMM

В корневом `docker-compose.yml`:

```yaml
smm:
  build:
    context: ./smm
    dockerfile: Dockerfile
```

`context: ./smm` подразумевает каталог `smm/` с `package.json`, `client/`, `server/`, `vite.config.ts` и т.д. Если структура другая, используйте корректный контекст, например:

```yaml
smm:
  build:
    context: ..         # корень проекта
    dockerfile: deploy/smm/Dockerfile
```

В `deploy/docker-compose.yml` задано:

```yaml
context: ..
dockerfile: deploy/smm/Dockerfile
```

В этом случае `./smm` должен содержать полный проект (часто через копирование или монтирование при деплое).
