# Docker + AWS SDK: Решение проблем интеграции 

## Обзор проблемы

При контейнеризации приложения с использованием Docker возникает проблема с доступностью пакетов AWS SDK, необходимых для работы с Beget S3.

## Симптомы

1. При запуске приложения в контейнере возникают ошибки:
   ```
   Error: Cannot find module '@aws-sdk/client-s3'
   ```

2. Ошибка ERR_MODULE_NOT_FOUND для пакетов:
   - `@aws-sdk/client-s3`
   - `@aws-sdk/s3-request-presigner`
   - `@aws-sdk/lib-storage`

## Причины

1. **Проблема монтирования томов**: Монтирование директории `node_modules` в `docker-compose.yml` блокирует доступ к установленным внутри контейнера пакетам.

2. **Порядок операций в Dockerfile**: Несмотря на установку пакетов в Dockerfile, при определенных конфигурациях они могут быть недоступны после создания контейнера.

## Решения

### Решение 1: Исправление docker-compose.yml

Закомментируйте или удалите строку монтирования `node_modules` в `docker-compose.yml`:

```yaml
volumes:
  - ./smm:/app
  #- /app/node_modules
```

### Решение 2: Установка пакетов после запуска контейнера

Дополните скрипт деплоя (deploy.sh) установкой пакетов в запущенном контейнере:

```bash
# После запуска контейнеров
echo -e "${YELLOW}Определение имени контейнера smm...${NC}"
CONTAINER_ID=$(docker ps | grep smm | awk '{print $1}')

if [ -z "$CONTAINER_ID" ]; then
    echo -e "${RED}Контейнер smm не найден. Проверьте его статус.${NC}"
    docker ps
    exit 1
fi

echo -e "${GREEN}Найден контейнер smm: $CONTAINER_ID${NC}"
echo -e "${YELLOW}Установка пакетов AWS SDK в контейнере smm...${NC}"
docker exec -i $CONTAINER_ID npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage --save
```

### Решение 3: Использование mock AWS SDK для тестирования

Создайте файл `server/services/beget-s3-storage-mock.ts` для эмуляции работы с S3 API при отсутствии AWS SDK:

```typescript
/**
 * Мок-реализация S3 клиента для тестирования
 */
export class MockS3Client {
  // Методы для эмуляции S3 клиента
}
```

### Решение 4: Явная установка в Dockerfile

Убедитесь, что установка AWS SDK в Dockerfile явно прописана и проверяется:

```dockerfile
# Устанавливаем AWS SDK для работы с Beget S3 (приоритетно)
RUN npm install --save --no-audit \
    @aws-sdk/client-s3@3.523.0 \
    @aws-sdk/s3-request-presigner@3.523.0 \
    @aws-sdk/lib-storage@3.523.0 \
    && npm ls @aws-sdk/client-s3 \
    && echo "AWS SDK установлен успешно"

# Проверяем доступность AWS SDK
RUN node -e "try { require('@aws-sdk/client-s3'); console.log('AWS SDK client-s3 доступен'); } catch (e) { console.error('Ошибка импорта AWS SDK:', e); process.exit(1); }"
```

## Проверка интеграции с Beget S3

Для проверки успешной интеграции с Beget S3 можно использовать тестовый скрипт, который пытается загрузить небольшой файл:

```javascript
// test-beget-s3.js
// Скрипт для тестирования загрузки файлов в Beget S3
```

## Настройки окружения для Beget S3

Убедитесь, что в файле `.env` правильно настроены следующие переменные:

```
BEGET_S3_ACCESS_KEY=9GKH5CY@27DGMDRR7682
BEGET_S3_SECRET_KEY=wNgp3IoHQDDr3gWAqUe@r0Ckt5oy5dWhPRULHRS9
BEGET_S3_BUCKET=ваш-бакет
BEGET_S3_ENDPOINT=https://s3.ru1.storage.beget.cloud  # или другой соответствующий endpoint
BEGET_S3_REGION=ru-1  # или другой регион хранилища
```

## Проблемы доступа к файлам (AccessDenied)

Если при загрузке файлов возникает ошибка `AccessDenied` при попытке получить загруженный файл, убедитесь что:

1. В запросе на загрузку файла установлен параметр `ACL: 'public-read'`
2. Корректно настроены разрешения для бакета в панели Beget
3. В URL для доступа к файлу используется правильное имя бакета

## Логирование для отладки

Для детальной отладки проблем с AWS SDK добавьте дополнительное логирование в сервисы работы с S3:

```typescript
// В файле beget-s3-storage-aws.ts
console.log('S3 Client config:', {
  endpoint: this.endpoint,
  region: this.region,
  credentials: {
    accessKeyId: "***" + this.credentials.accessKeyId.slice(-4),
    secretAccessKey: "***" + this.credentials.secretAccessKey.slice(-4)
  }
});
```