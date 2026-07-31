# E2E-стенд (AI-36)

Изолированное окружение для Playwright. Прод для прогонов **не используется**:
тесты создают кампании, контент и публикации.

## Зачем отдельный стенд

Боевые `SMM_HOST`, `SMM_HOST_ALT`, `SMM_HOST_ALT2` — это три алиаса traefik на
**один и тот же контейнер и один и тот же Directus**. Отдельной среды не
существовало, поэтому единственным способом прогнать набор был прод.

## Запуск

```bash
cp e2e/env.e2e.sample /root/smm-e2e/.env.e2e   # заполнить CHANGE_ME
cp e2e/docker-compose.yml /root/smm-e2e/
cd /root/smm-e2e
docker compose --env-file .env.e2e up -d
```

Приложение: `http://127.0.0.1:5100`, Directus стенда: `http://127.0.0.1:8155`.
Наружу не публикуется ничего — портов на внешнем интерфейсе нет, меток traefik
нет.

## Схема Directus

Переносится снапшотом с прода, **данные не копируются**: тесты создают себе всё
сами, а копия боевой базы — это утечка и лишний риск.

```bash
docker exec root-directus-1 sh -c 'cd /directus && node cli.js schema snapshot --yes /tmp/s.yaml'
docker cp root-directus-1:/tmp/s.yaml ./schema.yaml
# см. «Грабли» ниже — снапшот требует правки перед применением
docker cp ./schema.yaml smm-e2e-directus-e2e-1:/tmp/s.yaml
docker exec smm-e2e-directus-e2e-1 sh -c 'cd /directus && node cli.js schema apply --yes /tmp/s.yaml'
```

## Грабли, которые стоили времени

**1. Снапшот боевой схемы не применяется как есть.** В `directus_settings.key`
стоит `max_length: -5`, и Postgres отвергает `varchar(-5)`. Перед применением
поправить на `null`. Это дефект боевой схемы: он не мешает работающему проду и
вылезает только при переносе.

**2. Directus отвергает email на домене `.invalid`.** Валидатор email не
пропускает такой адрес, и первый bootstrap при этом **молча не создаёт
администратора вовсе** — ошибки в логах нет, просто ноль пользователей.
Использовать `@example.com`. Если админ не создался, завести вручную:

```bash
docker exec smm-e2e-postgres-e2e-1 psql -U postgres -d directus \
  -tAc "select id,name from directus_roles;"
docker exec smm-e2e-directus-e2e-1 sh -c \
  'cd /directus && node cli.js users create --email <email> --password <pass> --role <role-id>'
```

**3. Образ стенда — тот же `root-smm:deployed`, что на проде.** Стенд обязан
проверять выкаченный код. Если прод отстал от `origin/main`, стенд поднимется
на старом коде: сверяйте `curl -s http://127.0.0.1:5100/health | jq -r .revision`
с `origin/main`.

## Фоновые задачи

На стенде выключены целиком через `DISABLE_BACKGROUND_JOBS=1`: планировщик
публикаций, валидатор статусов, восстановление автономных кампаний,
телеграм-бот, ротация VK-токенов и наблюдатель вовлечённости. Проверить:

```bash
docker logs smm-e2e-smm-e2e-1 2>&1 | grep background-jobs
```

Должно быть семь строк «пропущен». Внешние токены в `.env.e2e` пустые
намеренно: даже если задача каким-то образом стартует, публиковать некуда.

## Прогон тестов

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5100 npx playwright test
```

`PLAYWRIGHT_BASE_URL` обязателен. Без него конфиг падает намеренно: раньше в
`playwright.config.ts` стоял `webServer`, который поднимал приложение через
`npm run dev` — на прод-хосте это второй планировщик и второй телеграм-бот на
боевой базе, то есть дубли публикаций в живых кампаниях.
