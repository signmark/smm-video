# Тестирование автономной AI системы

Комплексная тестовая среда для автономной AI системы SMM Manager включает unit, integration и end-to-end тесты.

## Структура тестов

```
server/__tests__/
├── setup.ts                          # Глобальная настройка тестов и моки
├── jest.setup.js                     # Jest конфигурация
├── test-database.ts                  # Тестовая база данных и моки
├── test-utils.ts                     # Утилиты для тестов
├── autonomous-ai.test.ts             # Unit тесты автономной AI
├── autonomous-ai-integration.test.ts # Integration тесты API
├── autonomous-ai-e2e.test.ts        # End-to-end тесты workflow
└── README.md                        # Эта документация
```

## Типы тестов

### Unit тесты (`autonomous-ai.test.ts`)
Тестируют отдельные функции и инструменты автономной AI системы:
- ✅ Инструменты: `createContent`, `getKeywordsFromWebsite`, `generateKeywords`
- ✅ Обработка команд и парсинг JSON ответов
- ✅ Обработка ошибок в инструментах
- ✅ Логика принятия решений AI
- ✅ Валидация параметров

### Integration тесты (`autonomous-ai-integration.test.ts`)
Тестируют API эндпоинты и взаимодействие компонентов:
- ✅ POST `/api/ai-assistant/process-command`
- ✅ Авторизация и токены
- ✅ Обработка множественных инструментов
- ✅ Автоматическое добавление campaignId
- ✅ Fallback эндпоинты

### End-to-End тесты (`autonomous-ai-e2e.test.ts`)
Тестируют полные пользовательские сценарии:
- ✅ Создание контента от команды до сохранения
- ✅ Анализ сайта и извлечение ключевых слов
- ✅ Комплексные workflow с несколькими инструментами
- ✅ Управление контентом и планирование
- ✅ Обработка ошибок в комплексных сценариях
- ✅ Валидация безопасности и прав доступа

## Команды для запуска тестов

### Основные команды
```bash
# Запуск всех тестов
npm test

# Запуск с отслеживанием изменений
npm run test:watch

# Запуск с покрытием кода
npm run test:coverage
```

### Специализированные команды
```bash
# Только тесты автономной AI
npm run test:ai

# Только integration тесты
npm run test:integration

# Только E2E тесты
npm run test:e2e

# Только unit тесты
npm run test:unit

# Для CI/CD
npm run test:ci

# Отладка тестов
npm run test:debug
```

## Настройка окружения

### Переменные окружения для тестов
```bash
NODE_ENV=test              # Тестовая среда
TEST_MODE=true            # Режим тестирования
SUPPRESS_CONSOLE=true     # Отключить консольные сообщения
```

### Автоматические моки
Тесты используют автоматические моки для:
- **axios** - HTTP запросы к внешним API
- **Gemini AI сервис** - ответы от AI модели
- **Directus CRUD** - операции с базой данных
- **Авторизация** - токены и пользователи

## Структура тестовых данных

### Тестовые сущности
```typescript
// Тестовая кампания
campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e'
userId: 'test-user-id'

// Тестовые токены
authToken: 'Bearer test_valid_token'
```

### Моки AI ответов
```typescript
// Структура планов от AI
{
  action: "описание действия",
  tools: [
    {
      name: "название_инструмента", 
      params: { /* параметры */ }
    }
  ],
  response: "ответ пользователю"
}
```

## Покрытие кода

### Целевые показатели
- **Общее покрытие**: 70%
- **Автономная AI система**: 85%
- **Критические модули**: 80%+

### Отчеты
```bash
# HTML отчет в coverage/
npm run test:coverage

# Только в консоли
npm test -- --coverage --coverageReporters=text
```

## Отладка тестов

### Распространенные проблемы

**Ошибки авторизации**
```bash
# Проверьте моки в setup.ts
Authorization header missing -> Добавить validToken в запрос
```

**Ошибки AI ответов**
```bash
# Проверьте моки Gemini сервиса
JSON не найден -> Проверить формат geminiMock.generateContent
```

**Ошибки базы данных**
```bash
# Проверьте test-database.ts
Collection not found -> Добавить в initializeTestData()
```

### Режим отладки
```bash
# Отладка с точками останова
npm run test:debug

# Запуск одного теста
npm test -- --testNamePattern="должен создать контент"

# Подробный вывод
npm test -- --verbose
```

## Лучшие практики

### Написание тестов
1. **Изоляция** - каждый тест независим
2. **Моки** - используйте clearMocks() в beforeEach()
3. **Данные** - не полагайтесь на глобальное состояние
4. **Assertions** - проверяйте конкретные значения

### Именование тестов
```typescript
describe('Компонент/Функция', () => {
  test('должен делать что-то при условии X', async () => {
    // Arrange - подготовка
    // Act - действие  
    // Assert - проверка
  });
});
```

### Async/Await
```typescript
// ✅ Правильно
test('async test', async () => {
  const result = await someAsyncFunction();
  expect(result).toBe(expected);
});

// ❌ Неправильно  
test('async test', () => {
  someAsyncFunction().then(result => {
    expect(result).toBe(expected);
  });
});
```

## Мониторинг и CI/CD

### GitHub Actions
```yaml
- name: Run tests
  run: npm run test:ci
  
- name: Upload coverage
  uses: codecov/codecov-action@v3
```

### Критерии прохождения
- ✅ Все тесты проходят
- ✅ Покрытие кода ≥ 70%
- ✅ Нет ESLint ошибок
- ✅ TypeScript компилируется

## Добавление новых тестов

### Для нового инструмента AI
1. Добавьте unit тест в `autonomous-ai.test.ts`
2. Добавьте integration тест в `autonomous-ai-integration.test.ts`
3. Добавьте E2E сценарий в `autonomous-ai-e2e.test.ts`

### Для нового API эндпоинта
1. Создайте отдельный файл `{endpoint-name}.test.ts`
2. Следуйте структуре существующих integration тестов
3. Добавьте моки в `setup.ts` при необходимости

## Поддержка и развитие

Эта тестовая среда покрывает все аспекты автономной AI системы и обеспечивает:
- 🛡️ **Надежность** - раннее обнаружение ошибок
- 🚀 **Скорость разработки** - уверенность в изменениях  
- 📊 **Качество кода** - измеримые метрики покрытия
- 🔄 **Регрессионное тестирование** - защита от поломок

Для вопросов и улучшений создавайте issues в репозитории проекта.