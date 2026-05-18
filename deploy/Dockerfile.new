# Используем актуальную версию Node.js
FROM node:18

# Устанавливаем рабочий каталог
WORKDIR /app

# Устанавливаем системные зависимости через apt
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Копируем package.json и package-lock.json
COPY package*.json ./

# Очищаем существующие node_modules и lock-файлы для чистой установки
RUN rm -rf node_modules package-lock.json

# Устанавливаем зависимости
RUN npm install --no-audit --verbose

# Явно устанавливаем react-draggable
RUN npm install react-draggable@4.4.6 --save --no-audit

# Явно устанавливаем multer
RUN npm install multer@1.4.5-lts.2 @types/multer@1.4.12 --save --no-audit

# Проверяем наличие библиотек
RUN npm ls react-draggable && npm ls multer

# Копируем исходный код
COPY . .

# Экспортируем порт для приложения
EXPOSE 5000

# Команда для сборки и запуска приложения
CMD ["npm", "run", "dev"]