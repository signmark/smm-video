# Руководство по использованию Beget S3 API

Это руководство описывает доступные API-маршруты для работы с Beget S3 хранилищем.

## Настройка переменных окружения

Для работы с Beget S3 необходимо настроить следующие переменные окружения:

```sh
# Основные настройки Beget S3
BEGET_S3_ACCESS_KEY=your_access_key
BEGET_S3_SECRET_KEY=your_secret_key
BEGET_S3_BUCKET=your_bucket_name

# Дополнительные настройки (опционально)
BEGET_S3_ENDPOINT=https://s3.ru1.storage.beget.cloud
BEGET_S3_REGION=ru-central-1
```

## Доступные API-маршруты

### Проверка подключения к Beget S3

```
POST /api/beget-s3/test
```

**Описание:** Проверяет подключение к Beget S3 и возвращает информацию о настройках.

**Пример ответа:**
```json
{
  "success": true,
  "message": "Beget S3 API работает",
  "timestamp": "2025-04-15T19:12:49.270Z",
  "test_id": 1744744369270,
  "connection": {
    "hasCredentials": true,
    "endpoint": "https://s3.ru1.storage.beget.cloud",
    "bucket": "your-bucket-name"
  }
}
```

### Загрузка текстового контента

```
POST /api/beget-s3/upload-content
```

**Описание:** Загружает текстовый контент в Beget S3 хранилище.

**Параметры запроса:**
- `content` (строка, обязательный) - Текстовый контент для загрузки
- `filename` (строка, опционально) - Имя файла
- `contentType` (строка, опционально) - MIME-тип контента (по умолчанию 'text/plain')
- `folder` (строка, опционально) - Папка для сохранения

**Пример запроса:**
```json
{
  "content": "Тестовый контент для загрузки",
  "filename": "test-file.txt",
  "contentType": "text/plain",
  "folder": "test-uploads"
}
```

**Пример ответа:**
```json
{
  "success": true,
  "url": "https://your-bucket.s3.ru1.storage.beget.cloud/test-uploads/test-file.txt",
  "key": "test-uploads/test-file.txt",
  "contentType": "text/plain",
  "timestamp": "2025-04-15T19:12:50.103Z"
}
```

### Загрузка файла

```
POST /api/beget-s3/upload
```

**Описание:** Загружает файл в Beget S3 хранилище.

**Параметры запроса (multipart/form-data):**
- `file` (файл, обязательный) - Загружаемый файл
- `fileName` (строка, опционально) - Имя файла
- `folder` (строка, опционально) - Папка для сохранения

**Пример ответа:**
```json
{
  "success": true,
  "url": "https://your-bucket.s3.ru1.storage.beget.cloud/uploads/example.jpg",
  "key": "uploads/example.jpg"
}
```

### Загрузка файла из URL

```
POST /api/beget-s3/upload-from-url
```

**Описание:** Загружает файл из внешнего URL в Beget S3 хранилище.

**Параметры запроса:**
- `url` (строка, обязательный) - URL файла для загрузки
- `fileName` (строка, опционально) - Имя файла
- `contentType` (строка, опционально) - MIME-тип контента
- `folder` (строка, опционально) - Папка для сохранения

**Пример запроса:**
```json
{
  "url": "https://example.com/image.jpg",
  "fileName": "downloaded-image.jpg",
  "folder": "images"
}
```

**Пример ответа:**
```json
{
  "success": true,
  "url": "https://your-bucket.s3.ru1.storage.beget.cloud/images/downloaded-image.jpg",
  "key": "images/downloaded-image.jpg"
}
```

### Получение списка файлов

```
GET /api/beget-s3/list
```

**Описание:** Получает список файлов в хранилище.

**Параметры запроса (query):**
- `folder` (строка, опционально) - Папка для просмотра
- `maxKeys` (число, опционально) - Максимальное количество файлов для получения (по умолчанию 1000)

**Пример ответа:**
```json
{
  "success": true,
  "files": [
    "image1.jpg",
    "folder/file.txt",
    "videos/sample.mp4"
  ],
  "count": 3
}
```

### Получение временной ссылки на файл

```
GET /api/beget-s3/signed-url/:key
```

**Описание:** Получает временную ссылку на файл с ограниченным сроком действия.

**Параметры запроса:**
- `key` (строка, обязательный) - Ключ файла в S3
- `expiration` (число, опционально) - Срок действия ссылки в секундах (по умолчанию 3600 = 1 час)

**Пример ответа:**
```json
{
  "success": true,
  "url": "https://your-bucket.s3.ru1.storage.beget.cloud/file.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...",
  "expiresIn": 3600,
  "key": "file.txt"
}
```

### Удаление файла

```
DELETE /api/beget-s3/delete/:key
```

**Описание:** Удаляет файл из хранилища.

**Параметры запроса:**
- `key` (строка, обязательный) - Ключ файла в S3

**Пример ответа:**
```json
{
  "success": true,
  "message": "File file.txt deleted successfully"
}
```

### Проверка существования файла

```
GET /api/beget-s3/exists/:key
```

**Описание:** Проверяет существование файла в хранилище.

**Параметры запроса:**
- `key` (строка, обязательный) - Ключ файла в S3

**Пример ответа:**
```json
{
  "success": true,
  "exists": true,
  "key": "file.txt"
}
```

### Получение информации о Beget S3

```
GET /api/beget-s3/info
```

**Описание:** Получает информацию о настройках Beget S3 и тестовый список файлов.

**Пример ответа:**
```json
{
  "success": true,
  "configuration": {
    "endpoint": "https://s3.ru1.storage.beget.cloud",
    "region": "ru-central-1",
    "bucket": "your-bucket-name",
    "hasCredentials": true
  },
  "test": {
    "filesCount": 5,
    "sampleFiles": [
      "image.jpg",
      "document.pdf",
      "folder/file.txt",
      "test-uploads/test-file.txt",
      "videos/sample.mp4"
    ],
    "timestamp": "2025-04-15T19:12:50.929Z"
  }
}
```

## Пример использования в JavaScript

### Загрузка контента

```javascript
// Загрузка текстового контента
async function uploadTextContent() {
  const response = await fetch('http://localhost:5000/api/beget-s3/upload-content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      content: 'Тестовый контент для загрузки',
      filename: 'test-file.txt',
      folder: 'uploads'
    })
  });
  
  const result = await response.json();
  console.log('Файл загружен:', result.url);
}

// Загрузка файла из формы
async function uploadFile(fileInput) {
  const formData = new FormData();
  const file = fileInput.files[0];
  
  formData.append('file', file);
  formData.append('folder', 'uploads');
  
  const response = await fetch('http://localhost:5000/api/beget-s3/upload', {
    method: 'POST',
    body: formData
  });
  
  const result = await response.json();
  console.log('Файл загружен:', result.url);
}
```

### Получение списка файлов

```javascript
async function listFiles() {
  const response = await fetch('http://localhost:5000/api/beget-s3/list?folder=uploads', {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  const result = await response.json();
  console.log(`Получено ${result.count} файлов:`, result.files);
}
```

## Пример использования в curl

```bash
# Проверка подключения
curl -X POST "http://localhost:5000/api/beget-s3/test" \
  -H "Accept: application/json"

# Загрузка контента
curl -X POST "http://localhost:5000/api/beget-s3/upload-content" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"content": "Тестовый контент", "filename": "test.txt", "folder": "test-api"}'

# Получение списка файлов
curl -s "http://localhost:5000/api/beget-s3/list?folder=test-api" | jq

# Проверка существования файла
curl -s "http://localhost:5000/api/beget-s3/exists/test-api/test.txt" | jq

# Получение информации о хранилище
curl -s "http://localhost:5000/api/beget-s3/info" | jq
```