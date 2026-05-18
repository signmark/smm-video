#!/bin/bash

# Скрипт для настройки и запуска инфраструктуры SMM Manager
# Использование: ./setup_infrastructure.sh [start|stop|restart|logs|status]

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для проверки наличия Docker
check_docker() {
    if ! command -v docker &> /dev/null
    then
        echo -e "${RED}Docker не установлен. Пожалуйста, установите Docker и Docker Compose.${NC}"
        echo -e "Инструкции по установке: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null
    then
        echo -e "${RED}Docker Compose не установлен. Пожалуйста, установите Docker Compose.${NC}"
        echo -e "Инструкции по установке: https://docs.docker.com/compose/install/"
        exit 1
    fi
}

# Функция для проверки наличия .env.docker файла
check_env_file() {
    if [ ! -f .env.docker ]; then
        echo -e "${YELLOW}Файл .env.docker не найден. Создание файла из образца...${NC}"
        if [ -f .env.sample ]; then
            cp .env.sample .env.docker
            echo -e "${GREEN}Файл .env.docker создан. Пожалуйста, отредактируйте его, установив правильные значения.${NC}"
        else
            echo -e "${RED}Файл образца .env.sample не найден. Пожалуйста, создайте файл .env.docker вручную.${NC}"
            exit 1
        fi
    fi
}

# Функция для подготовки каталогов
prepare_directories() {
    echo -e "${BLUE}Подготовка каталогов для хранения данных...${NC}"
    
    # Создание необходимых каталогов
    mkdir -p traefik_data
    mkdir -p postgres
    mkdir -p pgadmin_data
    mkdir -p directus_data
    mkdir -p n8n_data
    mkdir -p n8n-custom-scripts
    mkdir -p n8n-custom-nodes
    mkdir -p smm
    mkdir -p local-files
    mkdir -p redis_data
    mkdir -p minio_data
    mkdir -p couchdb_data
    mkdir -p budibase_data
    mkdir -p appsmith-stacks
    
    echo -e "${GREEN}Каталоги успешно созданы.${NC}"
}

# Функция для запуска инфраструктуры
start_infrastructure() {
    echo -e "${BLUE}Запуск инфраструктуры...${NC}"
    docker-compose --env-file .env.docker up -d
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Инфраструктура успешно запущена.${NC}"
        echo -e "${BLUE}Проверка статуса контейнеров:${NC}"
        docker-compose ps
    else
        echo -e "${RED}Произошла ошибка при запуске инфраструктуры.${NC}"
        exit 1
    fi
}

# Функция для остановки инфраструктуры
stop_infrastructure() {
    echo -e "${BLUE}Остановка инфраструктуры...${NC}"
    docker-compose down
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Инфраструктура успешно остановлена.${NC}"
    else
        echo -e "${RED}Произошла ошибка при остановке инфраструктуры.${NC}"
        exit 1
    fi
}

# Функция для просмотра логов
view_logs() {
    if [ -z "$1" ]; then
        echo -e "${BLUE}Просмотр логов всех сервисов...${NC}"
        docker-compose logs
    else
        echo -e "${BLUE}Просмотр логов сервиса $1...${NC}"
        docker-compose logs "$1"
    fi
}

# Функция для отображения статуса
show_status() {
    echo -e "${BLUE}Текущий статус контейнеров:${NC}"
    docker-compose ps
}

# Проверка наличия Docker
check_docker

# Основная логика скрипта
case "$1" in
    start)
        check_env_file
        prepare_directories
        start_infrastructure
        ;;
    stop)
        stop_infrastructure
        ;;
    restart)
        stop_infrastructure
        check_env_file
        start_infrastructure
        ;;
    logs)
        view_logs "$2"
        ;;
    status)
        show_status
        ;;
    *)
        echo -e "${YELLOW}Использование: $0 [start|stop|restart|logs|status]${NC}"
        echo -e "${YELLOW}  start   - запуск инфраструктуры${NC}"
        echo -e "${YELLOW}  stop    - остановка инфраструктуры${NC}"
        echo -e "${YELLOW}  restart - перезапуск инфраструктуры${NC}"
        echo -e "${YELLOW}  logs    - просмотр логов (опционально укажите имя сервиса)${NC}"
        echo -e "${YELLOW}  status  - отображение статуса контейнеров${NC}"
        exit 1
        ;;
esac

exit 0