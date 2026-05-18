# Инструкция по использованию локальных модулей AWS SDK для Beget S3

Эта инструкция объясняет, как использовать локально загруженные модули AWS SDK вместо их установки через npm, что может быть полезно при проблемах с доступом к npm репозиторию или ограничениях сети.

## Содержимое

1. [Подготовка локальных модулей](#1-подготовка-локальных-модулей)
2. [Проверка локальных модулей](#2-проверка-локальных-модулей)
3. [Использование в Dockerfile](#3-использование-в-dockerfile)
4. [Использование в Node.js приложении](#4-использование-в-nodejs-приложении)
5. [Копирование модулей на сервер вручную](#5-копирование-модулей-на-сервер-вручную)
6. [Решение проблем](#6-решение-проблем)

## 1. Подготовка локальных модулей

Локальные модули AWS SDK уже подготовлены и находятся в папке `custom_modules/@aws-sdk/`. Эта папка содержит следующие модули:

- `client-s3` - основной клиент для работы с S3
- `s3-request-presigner` - модуль для создания пресигнированных URL
- `lib-storage` - дополнительные утилиты для работы с хранилищем

Если папка отсутствует или вы хотите обновить модули, выполните следующие команды:

```bash
# Создание директорий
mkdir -p custom_modules/@aws-sdk
cd custom_modules/@aws-sdk

# Скачивание модулей
npm pack @aws-sdk/client-s3@3.441.0
npm pack @aws-sdk/s3-request-presigner@3.441.0
npm pack @aws-sdk/lib-storage@3.441.0

# Распаковка модулей
mkdir -p client-s3 s3-request-presigner lib-storage
tar -xzf aws-sdk-client-s3-3.441.0.tgz -C client-s3 --strip-components=1
tar -xzf aws-sdk-s3-request-presigner-3.441.0.tgz -C s3-request-presigner --strip-components=1
tar -xzf aws-sdk-lib-storage-3.441.0.tgz -C lib-storage --strip-components=1

# Удаление архивов
rm *.tgz
```

## 2. Проверка локальных модулей

Для проверки, что локальные модули работают корректно, запустите скрипт `test-local-aws-sdk.js`:

```bash
node test-local-aws-sdk.js
```

Если все модули загружены корректно, вы увидите сообщение об успешном завершении тестирования.

## 3. Использование в Dockerfile

Для использования локальных модулей AWS SDK в Docker, используйте подготовленный `Dockerfile.local-aws-sdk`:

```bash
# Сборка Docker образа с локальными модулями
docker build -t smm-app-local-aws-sdk -f Dockerfile.local-aws-sdk .

# Запуск контейнера
docker run -p 5000:5000 smm-app-local-aws-sdk
```

Или запустите скрипт проверки:

```bash
chmod +x check-aws-sdk-in-docker.sh
./check-aws-sdk-in-docker.sh
```

## 4. Использование в Node.js приложении

Для импорта локальных модулей в Node.js приложении, используйте следующий подход:

```javascript
// Настройка путей к локальным модулям
const S3_CLIENT_PATH = './custom_modules/@aws-sdk/client-s3';
const PRESIGNER_PATH = './custom_modules/@aws-sdk/s3-request-presigner';

// Импорт модулей
const { S3Client, PutObjectCommand } = require(S3_CLIENT_PATH);
const { getSignedUrl } = require(PRESIGNER_PATH);

// Использование как обычно
const s3Client = new S3Client({
  region: process.env.BEGET_S3_REGION || 'ru-1',
  endpoint: process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud',
  credentials: {
    accessKeyId: process.env.BEGET_S3_ACCESS_KEY,
    secretAccessKey: process.env.BEGET_S3_SECRET_KEY
  },
  forcePathStyle: true
});
```

## 5. Копирование модулей на сервер вручную

Если у вас нет доступа к npm на сервере, вы можете скопировать локальные модули вручную:

1. Скопируйте папку `custom_modules/@aws-sdk` на сервер
2. Создайте необходимые директории для модулей
3. Скопируйте модули в нужные директории

```bash
# На сервере
mkdir -p /app/node_modules/@aws-sdk/client-s3
mkdir -p /app/node_modules/@aws-sdk/s3-request-presigner
mkdir -p /app/node_modules/@aws-sdk/lib-storage

# Копирование модулей (пример с локального компьютера на сервер)
scp -r ./custom_modules/@aws-sdk/client-s3/* user@server:/app/node_modules/@aws-sdk/client-s3/
scp -r ./custom_modules/@aws-sdk/s3-request-presigner/* user@server:/app/node_modules/@aws-sdk/s3-request-presigner/
scp -r ./custom_modules/@aws-sdk/lib-storage/* user@server:/app/node_modules/@aws-sdk/lib-storage/
```

Или используйте подготовленный скрипт `copy-aws-sdk-modules.sh`:

```bash
chmod +x copy-aws-sdk-modules.sh
./copy-aws-sdk-modules.sh
```

## 6. Решение проблем

Если у вас возникают проблемы с локальными модулями AWS SDK, проверьте следующее:

1. **Отсутствуют зависимости модулей**: Локальные модули могут требовать дополнительные зависимости. В этом случае вы увидите ошибки вида `Cannot find module 'X'`. Решение: загрузите дополнительные модули аналогичным образом.

2. **Несовместимости версий**: Используйте одинаковые версии модулей для избежания несовместимостей.

3. **Неправильные пути**: Убедитесь, что пути к модулям указаны корректно относительно рабочей директории приложения.

4. **Ошибки в Node.js**: Для более подробной диагностики используйте `console.log` или отладчик Node.js.

Если проблемы не удаётся решить, можно использовать альтернативный подход без AWS SDK через сервис `beget-s3-direct.ts`.

---

Эта инструкция предоставляет базовую информацию по использованию локальных модулей AWS SDK. При необходимости обращайтесь к документации AWS SDK для Node.js для получения дополнительной информации.