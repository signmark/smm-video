#!/bin/bash

# Script for setting up and running SMM Manager infrastructure
# Usage: ./setup_infrastructure_en.sh [start|stop|restart|logs|status]

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null
    then
        echo -e "${RED}Docker is not installed. Please install Docker and Docker Compose.${NC}"
        echo -e "Installation instructions: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null
    then
        echo -e "${RED}Docker Compose is not installed. Please install Docker Compose.${NC}"
        echo -e "Installation instructions: https://docs.docker.com/compose/install/"
        exit 1
    fi
}

# Function to check if .env.docker file exists
check_env_file() {
    if [ ! -f .env.docker ]; then
        echo -e "${YELLOW}.env.docker file not found. Creating file from sample...${NC}"
        if [ -f .env.sample ]; then
            cp .env.sample .env.docker
            echo -e "${GREEN}.env.docker file created. Please edit it with correct values.${NC}"
        else
            echo -e "${RED}Sample file .env.sample not found. Please create .env.docker file manually.${NC}"
            exit 1
        fi
    fi
}

# Function to prepare directories
prepare_directories() {
    echo -e "${BLUE}Preparing directories for data storage...${NC}"
    
    # Create necessary directories
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
    
    echo -e "${GREEN}Directories successfully created.${NC}"
}

# Function to start infrastructure
start_infrastructure() {
    echo -e "${BLUE}Starting infrastructure...${NC}"
    docker-compose --env-file .env.docker up -d
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Infrastructure successfully started.${NC}"
        echo -e "${BLUE}Checking containers status:${NC}"
        docker-compose ps
    else
        echo -e "${RED}An error occurred while starting the infrastructure.${NC}"
        exit 1
    fi
}

# Function to stop infrastructure
stop_infrastructure() {
    echo -e "${BLUE}Stopping infrastructure...${NC}"
    docker-compose down
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Infrastructure successfully stopped.${NC}"
    else
        echo -e "${RED}An error occurred while stopping the infrastructure.${NC}"
        exit 1
    fi
}

# Function to view logs
view_logs() {
    if [ -z "$1" ]; then
        echo -e "${BLUE}Viewing logs of all services...${NC}"
        docker-compose logs
    else
        echo -e "${BLUE}Viewing logs of service $1...${NC}"
        docker-compose logs "$1"
    fi
}

# Function to display status
show_status() {
    echo -e "${BLUE}Current container status:${NC}"
    docker-compose ps
}

# Check if Docker is installed
check_docker

# Main script logic
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
        echo -e "${YELLOW}Usage: $0 [start|stop|restart|logs|status]${NC}"
        echo -e "${YELLOW}  start   - start infrastructure${NC}"
        echo -e "${YELLOW}  stop    - stop infrastructure${NC}"
        echo -e "${YELLOW}  restart - restart infrastructure${NC}"
        echo -e "${YELLOW}  logs    - view logs (optionally specify service name)${NC}"
        echo -e "${YELLOW}  status  - display container status${NC}"
        exit 1
        ;;
esac

exit 0