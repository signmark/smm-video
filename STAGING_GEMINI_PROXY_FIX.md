# Статус доступа к Gemini API на Staging

## ✅ Текущее состояние: РЕШЕНО

**Проблема:** Прямые запросы к Google AI Studio API блокировались из-за геолокации сервера (ошибка "User location is not supported").

**Решение (внедрено в коде):**
Мы изменили приоритет выбора API в `server/services/ai-service.ts`.
Теперь система **по умолчанию использует Vertex AI** (`geminiVertexDirect`), который:
1. Работает стабильно с европейских IP (включая Латвию).
2. Не требует использования SOCKS5 прокси.
3. Использует Service Account Credentials (настраивается в Global API Keys).

## ⚠️ Резервный механизм (Fallback)

Если запрос через Vertex AI не удался (например, проблема с квотами или credentials), система автоматически переключается на старый метод (Google AI Studio API с API Key).

**Для работы резервного метода на Staging все еще может потребоваться прокси.**

### Настройка прокси (только для Fallback):
Если вы заметите, что система часто выпадает в Fallback и выдает ошибки геолокации, убедитесь, что переменные окружения прокси настроены:

```bash
export FORCE_GEMINI_PROXY=true # Опционально, чтобы форсировать прокси для fallback
export PROXY_HOST=138.219.123.68
export PROXY_PORT=9710
export PROXY_USERNAME=PGjuJV
export PROXY_PASSWORD=cwZmJ3
```

## Как это работает в коде
`server/services/ai-service.ts`:
```typescript
// 1. Сначала пробуем Vertex AI
try {
  const vertexContent = await geminiVertexDirect.generateContent(...);
  if (vertexContent) return ...;
} catch (e) {
  // Логируем ошибку Vertex
}

// 2. Если не вышло — используем стандартный API (с прокси, если настроен)
// ... код стандартного запроса ...
```
