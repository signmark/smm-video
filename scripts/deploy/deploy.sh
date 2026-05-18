#!/bin/bash

# Цвета для удобного отображения информации
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}===== Запуск автоматизированного деплоя SMM Manager =====${NC}"

# Сохранение текущей директории
DEPLOY_DIR=$(pwd)

# Проверка наличия файла .env перед очисткой (чтобы не потерять настройки)
if [ -f "$DEPLOY_DIR/.env" ]; then
    echo -e "${YELLOW}Обнаружен существующий .env файл. Создаем резервную копию...${NC}"
    cp "$DEPLOY_DIR/.env" "$DEPLOY_DIR/.env.backup.$(date +%Y%m%d%H%M%S)"
    echo -e "${GREEN}Резервная копия .env файла создана${NC}"
fi

# Принудительная очистка Docker (удаление неиспользуемых образов, контейнеров, сетей и т.д.)
echo -e "${YELLOW}Очистка Docker от неиспользуемых ресурсов...${NC}"
docker system prune -a -f

# Проверка и переход в директорию smm/ если мы не в ней
echo -e "${YELLOW}Проверка текущей директории...${NC}"
CURRENT_DIR=$(basename "$PWD")
if [ "$CURRENT_DIR" != "smm" ]; then
    echo -e "${YELLOW}Переход в директорию smm/...${NC}"
    cd smm/ || { echo -e "${RED}Ошибка: директория smm/ не найдена${NC}"; exit 1; }
else
    echo -e "${GREEN}Уже находимся в директории smm/${NC}"
fi

# Обновление кода из Git-репозитория
echo -e "${YELLOW}Получение последних изменений из Git...${NC}"
git pull

# Проверка наличия fixed-docker-compose.yml и копирование его при необходимости
if [ -f "./fixed-docker-compose.yml" ]; then
    echo -e "${YELLOW}Обнаружен исправленный docker-compose.yml. Копирование...${NC}"
    cp ./fixed-docker-compose.yml ../docker-compose.yml
    echo -e "${GREEN}docker-compose.yml успешно обновлен${NC}"
fi

# Проверка наличия env.example и копирование его при необходимости
if [ -f "./env.example" ]; then
    if [ ! -f "../.env" ]; then
        echo -e "${YELLOW}Создание файла .env из шаблона...${NC}"
        cp ./env.example ../.env
        echo -e "${GREEN}Файл .env создан. ВНИМАНИЕ: необходимо отредактировать ключи Beget S3!${NC}"
    else
        echo -e "${GREEN}Файл .env уже существует, пропускаем копирование env.example${NC}"
    fi
fi

# Возврат в предыдущую директорию
cd "$DEPLOY_DIR"

# Предупреждение о необходимости проверки настроек Beget S3
echo -e "${YELLOW}ВАЖНО: Проверьте настройки Beget S3 в файле .env:${NC}"
echo -e "${YELLOW}  - BEGET_S3_ACCESS_KEY${NC}"
echo -e "${YELLOW}  - BEGET_S3_SECRET_KEY${NC}"
echo -e "${YELLOW}  - BEGET_S3_BUCKET${NC}"

# Запрос подтверждения перед продолжением
read -p "Настройки Beget S3 проверены? (y/n): " CONTINUE
if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
    echo -e "${RED}Необходимо настроить ключи Beget S3 перед продолжением.${NC}"
    echo -e "${YELLOW}Отредактируйте файл .env и запустите скрипт снова.${NC}"
    exit 1
fi

# Пересборка и запуск контейнеров в фоновом режиме
echo -e "${YELLOW}Запуск Docker контейнеров...${NC}"
docker-compose -f docker-compose.yml up -d --build

# Проверка запуска контейнеров
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Контейнеры успешно запущены!${NC}"
else
    echo -e "${RED}Ошибка при запуске контейнеров!${NC}"
    exit 1
fi

# Установка AWS SDK в контейнере smm
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

# Проверка установки
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Пакеты AWS SDK успешно установлены${NC}"
    
    # Дополнительная проверка доступности модуля lib-storage
    echo -e "${YELLOW}Проверка доступности модуля @aws-sdk/lib-storage...${NC}"
    docker exec -i $CONTAINER_ID node -e "try { require('@aws-sdk/lib-storage'); console.log('AWS SDK lib-storage успешно импортирован'); } catch (e) { console.error('Ошибка импорта lib-storage:', e); process.exit(1); }"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Модуль @aws-sdk/lib-storage успешно импортирован${NC}"
        echo -e "${YELLOW}Перезапуск контейнера smm...${NC}"
        docker restart $CONTAINER_ID
        echo -e "${GREEN}Деплой успешно завершен!${NC}"
    else
        echo -e "${RED}Ошибка при импорте модуля @aws-sdk/lib-storage${NC}"
        echo -e "${YELLOW}Попытка повторной установки...${NC}"
        docker exec -i $CONTAINER_ID npm install @aws-sdk/lib-storage --save
        docker restart $CONTAINER_ID
        echo -e "${GREEN}Контейнер перезапущен после повторной установки ${NC}"
    fi
else
    echo -e "${RED}Ошибка при установке пакетов AWS SDK${NC}"
    echo -e "${YELLOW}Проверьте логи контейнера: docker logs root-smm-1${NC}"
fi

echo -e "${GREEN}===== Деплой SMM Manager завершен =====${NC}"