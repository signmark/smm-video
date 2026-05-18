#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Загрузка переменных окружения из .env файла
if [ -f ./.env ]; then
    echo -e "${YELLOW}Загрузка переменных окружения из .env файла...${NC}"
    export $(grep -v '^#' .env | xargs)
fi

# Проверка наличия переменных окружения
if [ -z "$BEGET_S3_ACCESS_KEY" ] || [ -z "$BEGET_S3_SECRET_KEY" ] || [ -z "$BEGET_S3_BUCKET" ]; then
    echo -e "${RED}Ошибка: Не установлены необходимые переменные окружения (BEGET_S3_ACCESS_KEY, BEGET_S3_SECRET_KEY, BEGET_S3_BUCKET)${NC}"
    exit 1
fi

# Установка переменных для Beget S3
S3_BUCKET=${BEGET_S3_BUCKET}
S3_ACCESS_KEY=${BEGET_S3_ACCESS_KEY}
S3_SECRET_KEY=${BEGET_S3_SECRET_KEY}
S3_ENDPOINT=${BEGET_S3_ENDPOINT:-"https://s3.ru1.storage.beget.cloud"}
S3_REGION=${BEGET_S3_REGION:-"ru-central-1"}

echo -e "${GREEN}=== Тестирование Beget S3 через curl ===${NC}"
echo -e "${YELLOW}Используемая конфигурация:${NC}"
echo -e "${YELLOW}- Bucket: ${S3_BUCKET}${NC}"
echo -e "${YELLOW}- Endpoint: ${S3_ENDPOINT}${NC}"
echo -e "${YELLOW}- Region: ${S3_REGION}${NC}"
echo -e "${YELLOW}- Access Key: ${S3_ACCESS_KEY}${NC}"
echo -e "${YELLOW}- Secret Key: ${S3_SECRET_KEY:0:3}...${S3_SECRET_KEY: -3}${NC}"

# Создаем временную директорию для тестовых файлов
TEMP_DIR=$(mktemp -d)
TEST_FILE="${TEMP_DIR}/test-file.txt"
TEST_KEY="test-curl-$(date +%s).txt"

echo -e "\n${YELLOW}Создание тестового файла...${NC}"
echo "Тестовое содержимое S3 от $(date)" > "${TEST_FILE}"
echo -e "${GREEN}Тестовый файл создан: ${TEST_FILE}${NC}"
echo -e "${GREEN}Содержимое файла: $(cat ${TEST_FILE})${NC}"

# Формирование аутентификационных данных
DATE=$(date -u +"%Y%m%dT%H%M%SZ")
DATE_SCOPE=$(date -u +"%Y%m%d")

# Загрузка файла через curl с использованием AWS v4 подписи
echo -e "\n${YELLOW}Загрузка файла в Beget S3...${NC}"

# Подготовка curl-команды
S3_URL="${S3_ENDPOINT}/${S3_BUCKET}/${TEST_KEY}"
echo -e "${YELLOW}URL для загрузки: ${S3_URL}${NC}"

# Формируем HTTP-заголовки
CONTENT_TYPE="text/plain"
AMZ_CONTENT_SHA256=$(openssl dgst -sha256 -hex < "${TEST_FILE}" | sed 's/^.* //')
HOST=$(echo "${S3_ENDPOINT}" | sed -e 's|^[^/]*//||' -e 's|/.*$||')

# Отправляем запрос
curl -v -X PUT "${S3_URL}" \
    --header "Host: ${HOST}" \
    --header "Content-Type: ${CONTENT_TYPE}" \
    --header "x-amz-date: ${DATE}" \
    --header "x-amz-content-sha256: ${AMZ_CONTENT_SHA256}" \
    --header "x-amz-acl: public-read" \
    --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" \
    --upload-file "${TEST_FILE}"

UPLOAD_RESULT=$?

if [ ${UPLOAD_RESULT} -eq 0 ]; then
    echo -e "\n${GREEN}Файл успешно загружен в Beget S3!${NC}"
    PUBLIC_URL="${S3_ENDPOINT}/${S3_BUCKET}/${TEST_KEY}"
    echo -e "${GREEN}URL файла: ${PUBLIC_URL}${NC}"
    
    # Проверка доступности файла через curl
    echo -e "\n${YELLOW}Проверка доступности файла...${NC}"
    curl -s -I "${PUBLIC_URL}"
    
    # Получение содержимого файла
    echo -e "\n${YELLOW}Получение содержимого файла...${NC}"
    curl -s "${PUBLIC_URL}"
    echo # Добавляем перевод строки после вывода содержимого
    
    # Получение списка файлов с префиксом test-curl-
    echo -e "\n${YELLOW}Получение списка файлов с префиксом test-curl-...${NC}"
    
    # Формируем HTTP-заголовки для запроса списка файлов
    LIST_URL="${S3_ENDPOINT}/${S3_BUCKET}?prefix=test-curl-&max-keys=10"
    curl -s "${LIST_URL}" | grep -o '<Key>[^<]*</Key>' | sed 's/<Key>//g' | sed 's/<\/Key>//g'
else
    echo -e "\n${RED}Ошибка при загрузке файла в Beget S3!${NC}"
fi

# Удаляем временные файлы
echo -e "\n${YELLOW}Удаление временных файлов...${NC}"
rm -rf "${TEMP_DIR}"
echo -e "${GREEN}Временные файлы удалены${NC}"

echo -e "\n${GREEN}=== Тестирование Beget S3 через curl завершено ===${NC}"