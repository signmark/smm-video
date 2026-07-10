# Инструкция по деплою

**ВАЖНО:** `docker-compose.yml` лежит в `/root/` (родительская директория проекта). ВСЕГДА используй полный путь `-f /root/docker-compose.yml`. Не используй `cd /root/smm && docker compose up` — это не найдёт compose-файл.

## Обновление deploy.sh

Для улучшения процесса деплоя обновите ваш скрипт `deploy.sh`, который находится в родительской директории (уровнем выше директории smm).

## Обновление deploy.sh

1. Скопируйте содержимое файла `copy_to_parent_deploy.sh` из репозитория и вставьте его в файл `deploy.sh` в родительской директории:

```bash
# На сервере
cd ~  # Или перейдите в родительскую директорию, где расположен текущий deploy.sh
nano deploy.sh  # Или используйте другой редактор (vim, etc.)
```

2. Замените всё содержимое файла содержимым из `copy_to_parent_deploy.sh`.

3. Сохраните файл и сделайте его исполняемым:

```bash
chmod +x deploy.sh
```

## Что обновлено в скрипте deploy.sh

1. **Резервное копирование .env**: Автоматически создает резервную копию .env перед очисткой Docker.

2. **Копирование конфигураций**: 
   - Обнаруживает и копирует fixed-docker-compose.yml в родительскую директорию
   - Создает .env из env.example, если .env не существует

3. **Проверка настроек Beget S3**:
   - Выводит предупреждение о необходимости проверки ключей Beget S3
   - Запрашивает подтверждение перед продолжением

4. **Установка AWS SDK**:
   - Автоматически устанавливает необходимые пакеты AWS SDK в контейнере
   - Перезапускает контейнер после установки

5. **Улучшенный UI**:
   - Цветные сообщения для лучшей читаемости
   - Информативные сообщения о каждом шаге
   - Проверки успешности выполнения команд

## Как использовать

Запустите скрипт из родительской директории:

```bash
./deploy.sh
```

Следуйте инструкциям на экране для завершения процесса деплоя.

---

## Быстрая пересборка фронта (без Docker)

При изменении только клиентского кода (`client/`) не нужно пересобирать весь Docker-образ (3-5 мин). Достаточно:

```bash
cd /root/smm
git pull
npm run build
docker cp ./dist smm:/app/
docker restart smm
```

Это занимает **~10 секунд** вместо 3-5 минут.

**Когда нужен полный rebuild:**
```bash
docker compose -f /root/docker-compose.yml build --no-cache smm 2>&1 | tail -5 && docker compose -f /root/docker-compose.yml up -d smm 2>&1 | tail -3
```
- Изменения в `server/` (Node.js бэкенд)
- Изменения в `Dockerfile`
- Изменения в `package.json` (новые зависимости)
- Изменения в `esbuild` конфиге

**Когда достаточно быстрой сборки:**
- Изменения только в `client/src/` (React, CSS, компоненты)
- Обновление UI без затрагивания серверной логики

---

## Важные находки (для других агентов/сессий)

### Структура useAuth() — ловушка

`useAuth()` возвращает объект из React Context. Структура `user` зависит от того, откуда данные:

| Источник | `user` structure | Как читать email |
|----------|-----------------|-----------------|
| `/api/auth/me` (query) | `{ user: { id, email, isAdmin } }` | email **всегда** `unknown@email.com` (JWT не содержит email) |
| После логина (setQueryData) | `{ id, email, isAdmin }` | `user?.email` |

**Правильный способ** — запрашивать email через `/api/user/profile` (использует admin token для запроса к Directus):
```typescript
const { data: userProfile } = useQuery<{ email: string }>({
  queryKey: ['/api/user/profile', userId, token],
  enabled: !!userId,
});
const email = userProfile?.email; // "signmark@gmail.com"
```

**НЕ ИСПОЛЬЗУЙ** `JSON.parse(atob(token.split('.')[1]))` — JWT Directus НЕ содержит email, только `id, role, app_access, admin_access`.

### Container name

Контейнер называется `smm` (не `root-smm-1`):
```bash
docker cp ./dist smm:/app/
docker restart smm
```