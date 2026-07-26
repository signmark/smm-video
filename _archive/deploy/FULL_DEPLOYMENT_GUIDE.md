# Руководство по полному развертыванию SMM Manager

В этом руководстве описан процесс полного развертывания приложения SMM Manager с нуля, включая настройку Beget S3 для хранения медиафайлов и видео.

## Предварительные требования

Перед началом установки убедитесь, что у вас есть:

1. Сервер с установленным Docker и docker-compose
2. Git для клонирования репозитория
3. Доступ к аккаунту Beget S3 с созданным бакетом
4. Ключи доступа к Beget S3 (Access Key и Secret Key)

## Шаг 1: Подготовка сервера

Убедитесь, что на вашем сервере установлены все необходимые компоненты:

```bash
# Обновление пакетов
sudo apt update
sudo apt upgrade -y

# Установка необходимых инструментов
sudo apt install -y git curl wget ffmpeg

# Установка Docker и docker-compose (если еще не установлено)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Установка docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.3/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перезагрузка для применения изменений в группах
echo "Перезагрузите сервер, чтобы применить изменения, и затем продолжите установку"
```

После перезагрузки убедитесь, что Docker работает:

```bash
docker --version
docker-compose --version
```

## Шаг 2: Клонирование репозитория

Клонируйте основной репозиторий проекта:

```bash
cd /path/to/your/installation/directory
git clone https://github.com/your-username/smm-manager.git
cd smm-manager
```

## Шаг 3: Настройка окружения и ключей доступа

### 3.1. Проверка ключей Beget S3

Перед установкой убедитесь, что у вас есть следующие ключи и данные от Beget S3:

- Access Key (например: `9GKH5CY@27DGMDRR7682`)
- Secret Key (например: `wNgp3IoHQDDr3gWAqUe@r0Ckt5oy5dWhPRULHRS9`)
- Bucket Name (например: `6e679636ae90-ridiculous-seth`)
- S3 Endpoint (по умолчанию: `https://s3.ru1.storage.beget.cloud`)

### 3.2. Настройка конфигурационного файла

1. Перейдите в директорию `smm`:

```bash
cd smm
```

2. Откройте файл `env.example` и убедитесь, что в нем указаны правильные ключи Beget S3:

```bash
nano env.example
```

3. Проверьте и при необходимости измените следующие строки:

```
# Beget S3 Storage Configuration
BEGET_S3_ENDPOINT="https://s3.ru1.storage.beget.cloud"
BEGET_S3_REGION="ru-central-1"
BEGET_S3_BUCKET="your-bucket-name"
BEGET_S3_PUBLIC_URL="https://s3.ru1.storage.beget.cloud/your-bucket-name"
BEGET_S3_TEST_UPLOAD="false"

# Необходимо добавить ключи Beget S3:
BEGET_S3_ACCESS_KEY="your-access-key"
BEGET_S3_SECRET_KEY="your-secret-key"
```

Замените `your-access-key`, `your-secret-key` и `your-bucket-name` на ваши реальные значения.

## Шаг 4: Автоматическое развертывание

### 4.1. Копирование deploy.sh в родительскую директорию

Сначала нужно скопировать скрипт `copy_to_parent_deploy.sh` из директории `smm` в родительскую директорию под именем `deploy.sh`:

```bash
cd smm
cp copy_to_parent_deploy.sh ../deploy.sh
chmod +x ../deploy.sh
cd ..
```

Альтернативно, вы можете использовать скрипт `install-aws-sdk.sh`, который автоматически выполнит эту операцию:

```bash
cd smm
chmod +x install-aws-sdk.sh
./install-aws-sdk.sh
```

### 4.2. Запуск скрипта развертывания

После копирования запустите скрипт автоматического развертывания из родительской директории:

```bash
cd ..  # Если вы находитесь в директории smm
chmod +x deploy.sh
./deploy.sh
```

Скрипт выполнит следующие действия:

1. Очистит неиспользуемые ресурсы Docker
2. Обновит код из Git-репозитория
3. Скопирует конфигурационные файлы в нужные директории
4. Создаст файл `.env` с настройками (если его еще нет)
5. Соберет и запустит Docker-контейнеры
6. Установит необходимые пакеты AWS SDK в контейнере
7. Перезапустит контейнер для применения изменений

## Шаг 5: Проверка установки

После завершения развертывания проверьте работу приложения:

```bash
# Проверка работающих контейнеров
docker ps

# Проверка логов приложения
docker logs root-smm-1
```

## Шаг 6: Устранение неполадок

Если после развертывания возникли проблемы с AWS SDK или Beget S3, выполните следующие действия:

### 6.1. Прямая установка AWS SDK в контейнере

```bash
cd smm
chmod +x install-aws-sdk.sh
./install-aws-sdk.sh
```

### 6.2. Полная пересборка образа

Если предыдущие шаги не помогли, выполните полную пересборку образа:

```bash
cd /path/to/smm-manager
docker-compose down
docker-compose build --no-cache smm
docker-compose up -d
```

### 6.3. Проверка доступности Beget S3

Проверьте доступность Beget S3 из контейнера:

```bash
docker exec -it root-smm-1 bash -c 'curl -I $BEGET_S3_ENDPOINT'
```

## Дополнительные настройки

### Настройка автозапуска

Для настройки автоматического запуска контейнеров при перезагрузке сервера:

```bash
sudo systemctl enable docker
```

### Резервное копирование данных

Рекомендуется настроить регулярное резервное копирование файла `.env` и базы данных:

```bash
# Создание резервной копии .env
cp .env .env.backup.$(date +%Y%m%d)

# Резервное копирование базы данных (требуется настройка под вашу конфигурацию БД)
docker exec -t postgres pg_dump -U postgres mydatabase > backup_$(date +%Y%m%d).sql
```

## Технические подробности

### Важные компоненты системы

- **ffmpeg**: используется для обработки видео
- **AWS SDK**: необходим для взаимодействия с Beget S3
- **Docker**: обеспечивает изоляцию и простоту развертывания
- **PostgreSQL**: используется для хранения данных приложения
- **Express.js**: основа серверной части приложения

### Зависимости AWS SDK

Система использует следующие пакеты AWS SDK:
- @aws-sdk/client-s3
- @aws-sdk/s3-request-presigner
- @aws-sdk/lib-storage

### Структура директорий

- `/server`: серверная часть приложения
- `/client`: клиентская часть приложения
- `/shared`: общие компоненты
- `/server/services`: сервисы для работы с внешними API
- `/server/services/beget-s3-video-service.ts`: сервис для работы с видео через Beget S3
- `/server/services/beget-s3-storage-aws.ts`: хранилище для работы с Beget S3 через AWS SDK
- `/server/services/social`: сервисы для работы с социальными сетями

## Поддержка и обновления

Для получения поддержки и обновлений проекта:

1. Регулярно проверяйте обновления репозитория
2. При обновлении выполните повторное развертывание через `deploy.sh`
3. Следите за изменениями в конфигурации и зависимостях

## Заключение

После успешного выполнения всех шагов SMM Manager должен быть полностью развернут и готов к использованию. Если у вас возникли проблемы, обратитесь к разработчикам или смотрите лог-файлы для выявления и устранения причин ошибок.