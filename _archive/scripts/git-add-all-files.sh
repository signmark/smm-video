#!/bin/bash
# Скрипт для добавления всех ключевых файлов проекта в git
# Запустите через интерфейс Replit или выполните команды вручную

echo "=== ДОБАВЛЕНИЕ КЛЮЧЕВЫХ ФАЙЛОВ ПРОЕКТА В GIT ==="

# Основные конфигурационные файлы
git add package.json
git add tsconfig.json
git add vite.config.ts
git add tailwind.config.js 2>/dev/null || echo "tailwind.config.js не найден"
git add .env.template

# Docker файлы
git add Dockerfile
git add deploy/Dockerfile 2>/dev/null || echo "deploy/Dockerfile не найден"
git add docker-compose.yml 2>/dev/null || echo "docker-compose.yml не найден"

# Документация проекта
git add replit.md
git add README.md
git add ARCHITECTURE_SIMPLIFICATION_PLAN.md 2>/dev/null || echo "ARCHITECTURE файл не найден"
git add DEPLOYMENT_GUIDE.md 2>/dev/null || echo "DEPLOYMENT_GUIDE не найден"

# Серверная часть - основные файлы
git add server/index.ts
git add server/api/
git add server/middleware/
git add server/services/ 2>/dev/null || echo "server/services не найден"
git add server/routes/
git add server/directus.ts

# Клиентская часть - основные файлы
git add client/src/App.tsx
git add client/src/main.tsx
git add client/src/index.css
git add client/src/types.ts
git add client/src/components/stories/
git add client/src/components/ui/ 2>/dev/null || echo "ui компоненты не найдены"
git add client/src/utils/
git add client/src/lib/
git add client/src/hooks/
git add client/src/pages/

# Схемы данных (если есть)
git add shared/ 2>/dev/null || echo "shared папка не найдена"

echo "=== КОМАНДЫ ДОБАВЛЕНИЯ ЗАВЕРШЕНЫ ==="
echo "Теперь выполните:"
echo "git commit -m 'Add core project files for new agent onboarding'"
echo "git push"