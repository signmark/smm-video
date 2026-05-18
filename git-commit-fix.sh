#!/bin/bash
# Скрипт для коммита исправлений race condition

echo "🔧 Сброс staging area..."
git reset HEAD .

echo "🗑️  Удаление attached_assets из git..."
git rm -r --cached attached_assets/ 2>/dev/null || echo "attached_assets уже не в git"

echo "📝 Добавление файлов с кодом..."
git add server/services/directus-crud.ts
git add server/api/auth-routes.ts
git add .gitignore
git add replit.md

echo ""
echo "📋 Файлы в staging area:"
git diff --staged --name-only

echo ""
echo "📊 Статистика изменений:"
git diff --staged --stat

echo ""
read -p "Закоммитить эти файлы? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    git commit -m "Fix: Complete per-user token refresh locking"
    echo "✅ Коммит создан!"
    echo ""
    read -p "Запушить в origin langs? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]
    then
        git push origin langs
        echo "🚀 Изменения отправлены в репозиторий!"
    else
        echo "⏸️  Пуш отменен. Выполни вручную: git push origin langs"
    fi
else
    echo "⏸️  Коммит отменен."
fi
