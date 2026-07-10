# Google Cloud Vertex AI — Учетные данные

**Статус:** Используется как запасной вариант (Priority 5). Основной метод — Cloudflare Worker proxy.

## Информация о проекте
- **Project ID**: gen-lang-client-0762407615
- **Service Account Email**: vertexai@gen-lang-client-0762407615.iam.gserviceaccount.com

## Приоритеты API ключей Gemini

1. `.env` → `GEMINI_API_KEY` (через Cloudflare proxy)
2. Global Directus keys → `GEMINI_API_KEY` или `GOOGLE_API_KEY`
3. User-specific keys
4. Vertex AI → `.env` → `VERTEX_AI_API_KEY` (запасной вариант)

## Доступные модели
- **gemini-3.5-flash** — основная модель (по умолчанию)
- **gemini-3.0-pro** — высокое качество
- **gemini-2.5-pro** — проверенная модель
- **gemini-2.5-flash** — быстрая и дешёвая

## Примечания
- Vertex AI используется только как запасной вариант при недоступности Cloudflare proxy
- Основной метод — Cloudflare Worker proxy (`GEMINI_PROXY_URL`)
- Прямое использование `google-auth-library` запрещено
- Продакшн домен: `smm.omemo.tech`
