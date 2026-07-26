# Заметки по деплою

> **Канон переехал в [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md)** — там compose-файл, откуда
> берётся окружение и команды пересборки. Здесь остались только сопутствующие находки.
>
> Раздел про `deploy.sh` / `copy_to_parent_deploy.sh` / `fixed-docker-compose.yml` удалён
> 2026-07-26: этот путь деплоя не действовал и был опасен, разбор — в
> [`_archive/deploy/README.md`](../../_archive/deploy/README.md).

**Главное правило:** `docker-compose.yml` лежит в `/root/`, а не в репозитории. ВСЕГДА
используй полный путь `-f /root/docker-compose.yml`. Не используй
`cd /root/smm && docker compose up` — compose-файла там нет.

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