# Руководство по интеграции с Beget S3

Данное руководство содержит информацию о настройке и интеграции хранилища Beget S3 с приложением SMM Manager для загрузки и хранения медиафайлов (изображений и видео).

## 1. Подготовка учетной записи Beget S3

### 1.1. Создание аккаунта на Beget

1. Перейдите на сайт [Beget](https://beget.com/ru)
2. Зарегистрируйте новую учетную запись или войдите в существующую
3. Перейдите в раздел «Хранилища» → «S3»

### 1.2. Создание бакета в Beget S3

1. В разделе S3 создайте новый бакет
2. Запишите название бакета (оно будет использоваться в конфигурации)
3. Настройте публичный доступ к бакету для возможности просмотра загруженных файлов

### 1.3. Получение ключей доступа

1. В настройках аккаунта найдите или создайте ключи доступа к S3
2. Вам потребуются:
   - Access Key (например: `9GKH5CY@27DGMDRR7682`)
   - Secret Key (например: `wNgp3IoHQDDr3gWAqUe@r0Ckt5oy5dWhPRULHRS9`)
3. Сохраните эти ключи в надежном месте

## 2. Настройка окружения приложения

### 2.1. Конфигурация переменных окружения

Добавьте следующие переменные в файл `.env`:

```
# Beget S3 Storage Configuration
BEGET_S3_ENDPOINT="https://s3.ru1.storage.beget.cloud"
BEGET_S3_REGION="ru-central-1"
BEGET_S3_BUCKET="your-bucket-name"
BEGET_S3_PUBLIC_URL="https://s3.ru1.storage.beget.cloud/your-bucket-name"
BEGET_S3_TEST_UPLOAD="false"

# Ключи доступа Beget S3
BEGET_S3_ACCESS_KEY="your-access-key"
BEGET_S3_SECRET_KEY="your-secret-key"
```

Замените `your-bucket-name`, `your-access-key` и `your-secret-key` на ваши реальные значения.

### 2.2. Настройка Docker-окружения

Убедитесь, что в вашем Dockerfile установлены необходимые зависимости:

```dockerfile
# Установка AWS SDK и зависимостей для работы с видео
RUN npm install --save @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage

# Установка ffmpeg для обработки видео
RUN apt-get update && apt-get install -y ffmpeg curl wget
```

## 3. Установка AWS SDK в существующий контейнер

Если у вас уже запущен контейнер, и вы хотите добавить поддержку Beget S3, выполните скрипт `install-aws-sdk.sh`:

```bash
cd smm
chmod +x install-aws-sdk.sh
./install-aws-sdk.sh
```

Этот скрипт:
1. Проверит наличие необходимых файлов конфигурации
2. Скопирует их в нужные директории
3. Установит пакеты AWS SDK в контейнер
4. Перезапустит контейнер для применения изменений

## 4. Использование Beget S3 в приложении

### 4.1. Загрузка файлов

Система автоматически использует настроенное S3-хранилище для:
- Загрузки изображений в соцсети
- Хранения видеофайлов
- Хранения временных файлов при обработке медиа

### 4.2. Работа с видео

Для работы с видео система использует:
- `ffmpeg` для создания превью и обработки видео
- AWS SDK для загрузки файлов в Beget S3
- Специальные сервисы для интеграции с социальными платформами

## 5. Проверка конфигурации

### 5.1. Тестирование доступа к Beget S3

Для проверки доступа к хранилищу выполните:

```bash
# Прямая проверка из контейнера
docker exec -it root-smm-1 bash -c 'curl -I $BEGET_S3_ENDPOINT'

# Проверка через AWS SDK
docker exec -it root-smm-1 bash -c 'node -e "const { S3Client } = require(\"@aws-sdk/client-s3\"); const client = new S3Client({ region: process.env.BEGET_S3_REGION, endpoint: process.env.BEGET_S3_ENDPOINT, credentials: { accessKeyId: process.env.BEGET_S3_ACCESS_KEY, secretAccessKey: process.env.BEGET_S3_SECRET_KEY } }); console.log(\"S3 клиент создан успешно.\");"'
```

### 5.2. Тестирование загрузки файла

Для проверки возможности загрузки файла:

```bash
# Создание тестового файла
docker exec -it root-smm-1 bash -c 'echo "test content" > /tmp/test.txt'

# Загрузка через AWS SDK
docker exec -it root-smm-1 bash -c 'node -e "const { S3Client, PutObjectCommand } = require(\"@aws-sdk/client-s3\"); const fs = require(\"fs\"); const client = new S3Client({ region: process.env.BEGET_S3_REGION, endpoint: process.env.BEGET_S3_ENDPOINT, credentials: { accessKeyId: process.env.BEGET_S3_ACCESS_KEY, secretAccessKey: process.env.BEGET_S3_SECRET_KEY } }); async function uploadTest() { const fileContent = fs.readFileSync(\"/tmp/test.txt\"); const params = { Bucket: process.env.BEGET_S3_BUCKET, Key: \"test.txt\", Body: fileContent }; try { const data = await client.send(new PutObjectCommand(params)); console.log(\"Тестовый файл успешно загружен\", data); } catch (err) { console.error(\"Ошибка при загрузке файла:\", err); } } uploadTest();"'
```

## 6. Устранение проблем

### 6.1. Распространенные ошибки

#### a) Cannot find module '@aws-sdk/client-s3'

Решение: Установите пакеты AWS SDK:

```bash
docker exec -it root-smm-1 npm install --save @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage
```

#### b) AccessDenied при загрузке файлов

Решение: Проверьте правильность ключей Beget S3:

1. Убедитесь, что ключи в `.env` совпадают с ключами в аккаунте Beget
2. Перезапустите контейнер для применения новых ключей:
   ```bash
   docker restart root-smm-1
   ```

#### c) Endpoint Configuration Error

Решение: Проверьте правильность настройки endpoint:

```bash
echo $BEGET_S3_ENDPOINT
# Должно вернуть: https://s3.ru1.storage.beget.cloud
```

### 6.2. Полная пересборка контейнера

Если другие методы не помогают, выполните полную пересборку:

```bash
cd /path/to/smm-manager
docker-compose down
docker-compose build --no-cache smm
docker-compose up -d
```

## 7. Для разработчиков

### 7.1. Сервисы Beget S3 в приложении

- `/server/services/beget-s3-video-service.ts`: Сервис для работы с видео через Beget S3
- `/server/services/beget-s3-storage-aws.ts`: Хранилище для работы с Beget S3 через AWS SDK

### 7.2. Интеграция с социальными сетями

- `/server/services/social/telegram-s3-integration.ts`: Интеграция для отправки медиафайлов из S3 в Telegram
- `/server/services/social/social-publishing-with-imgur.ts`: Публикация контента с изображениями в социальные сети

## 8. Заключение

Правильная настройка Beget S3 критична для работы с медиафайлами в SMM Manager. При внесении изменений:

1. Всегда проверяйте конфигурационные файлы
2. Используйте актуальные ключи доступа
3. При возникновении проблем обращайтесь к логам контейнера
4. В случае необходимости полностью пересоберите контейнер

**Важно**: После настройки проведите полное тестирование функциональности загрузки и отправки медиафайлов в социальные сети, чтобы убедиться в корректной работе системы.