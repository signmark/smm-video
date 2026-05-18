#!/bin/bash
# Цвета для удобного отображения информации
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}===== Копирование env.example в родительскую директорию =====${NC}"

# Определение текущей директории
CURRENT_DIR=$(pwd)
BASE_DIR=$(dirname "$CURRENT_DIR")
DIR_NAME=$(basename "$CURRENT_DIR")

# Копирование улучшенного deploy.sh в базовую директорию
if [ -f "./copy_to_parent_deploy.sh" ]; then
    echo -e "${YELLOW}Копирование улучшенного скрипта deploy.sh в родительскую директорию...${NC}"
    cp ./copy_to_parent_deploy.sh ../deploy.sh
    chmod +x ../deploy.sh
    echo -e "${GREEN}Скрипт deploy.sh успешно обновлен в родительской директории${NC}"
else
    echo -e "${YELLOW}Файл copy_to_parent_deploy.sh не найден, пропускаем копирование${NC}"
fi

# Копирование fixed-docker-compose.yml в базовую директорию
if [ -f "./fixed-docker-compose.yml" ]; then
    echo -e "${YELLOW}Копирование исправленного docker-compose.yml в родительскую директорию...${NC}"
    cp ./fixed-docker-compose.yml ../docker-compose.yml
    echo -e "${GREEN}Файл docker-compose.yml успешно обновлен в родительской директории${NC}"
else
    echo -e "${YELLOW}Файл fixed-docker-compose.yml не найден, пропускаем копирование${NC}"
fi

# Копирование env.example в родительскую директорию
if [ -f "./env.example" ]; then
    # Резервное копирование существующего .env файла в родительской директории
    if [ -f "../.env" ]; then
        echo -e "${YELLOW}Создание резервной копии текущего .env файла...${NC}"
        cp ../.env ../.env.backup.$(date +%Y%m%d%H%M%S)
        echo -e "${GREEN}Резервная копия создана${NC}"
    fi
    
    # Копирование примера в .env в родительской директории
    cp ./env.example ../.env
    echo -e "${GREEN}Файл env.example скопирован в .env в родительской директории${NC}"
    echo -e "${YELLOW}Пожалуйста, отредактируйте ../.env файл и добавьте ваши ключи Beget S3${NC}"
else
    echo -e "${RED}Файл env.example не найден в текущей директории${NC}"
    exit 1
fi

echo -e "${GREEN}===== Все файлы успешно скопированы =====${NC}"
echo -e "${YELLOW}Для завершения настройки:${NC}"
echo -e "1. Отредактируйте ../.env файл и добавьте реальные ключи Beget S3"
echo -e "2. Запустите ../deploy.sh из родительской директории"