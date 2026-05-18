# Развертывание SMM Manager на smmniap.pw

## Проблема
На продакшене домен `smmniap.pw` возвращает HTML вместо JSON для API запросов, что вызывает ошибку регистрации: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

## Решение
Обновить конфигурацию Docker для правильной маршрутизации на домене `smmniap.pw`.

## Файлы для развертывания

### 1. docker-compose-smmniap.yml
Обновленная конфигурация Docker с:
- Поддержкой домена `smmniap.pw` и `www.smmniap.pw`
- Nginx для статической landing page
- Правильное проксирование API запросов

### 2. nginx.conf
Конфигурация Nginx с:
- Обслуживание статических файлов для `/landing`
- Проксирование API запросов `/api/*` к SMM приложению
- Поддержка страниц политик (`/privacy`, `/terms`, `/cookies`)

## Инструкции по развертыванию

### Шаг 1: Резервное копирование
```bash
# Создать резервную копию текущей конфигурации
cp docker-compose.yml docker-compose.yml.backup
```

### Шаг 2: Обновление конфигурации
```bash
# Заменить docker-compose.yml
cp docker-compose-smmniap.yml docker-compose.yml

# Скопировать конфигурацию nginx
cp nginx.conf ./nginx.conf
```

### Шаг 3: Перезапуск сервисов
```bash
# Остановить текущие контейнеры
docker-compose down

# Пересобрать и запустить с новой конфигурацией
docker-compose up -d --build

# Проверить статус сервисов
docker-compose ps
```

### Шаг 4: Проверка SSL сертификатов
```bash
# Проверить, что Traefik получил SSL сертификаты для smmniap.pw
docker-compose logs traefik | grep smmniap.pw
```

### Шаг 5: Тестирование
```bash
# Тест landing page
curl -I https://smmniap.pw/landing

# Тест API регистрации
curl -X POST https://smmniap.pw/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","firstName":"Test","lastName":"User"}'
```

## Ключевые изменения

### 1. Маршрутизация Traefik
- Добавлены правила для `smmniap.pw` и `www.smmniap.pw`
- Настроена правильная приоритетность маршрутов
- SSL сертификаты для нового домена

### 2. Nginx конфигурация
- `/landing` - статические файлы из smmniap_static
- `/api/*` - проксирование к SMM приложению
- Политики Facebook доступны на `/privacy`, `/terms`, `/cookies`

### 3. Переменные окружения
Убедитесь, что в `.env` файле указаны:
```env
DOMAIN_NAME=smmniap.pw
SSL_EMAIL=your-email@domain.com
```

## Устранение неполадок

### API возвращает HTML
- Проверить логи nginx: `docker-compose logs nginx`
- Убедиться, что SMM контейнер запущен: `docker-compose ps smm`

### SSL проблемы
- Проверить логи Traefik: `docker-compose logs traefik`
- Убедиться, что домен правильно указывает на сервер

### Статические файлы не загружаются
- Проверить монтирование томов: `docker-compose config`
- Убедиться, что файлы существуют в `smmniap_static/`