# ===========================================
# STAGE 1: Build
# ===========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Установка зависимостей для сборки (canvas, sharp и т.д.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    build-base

# Копируем package files
COPY package*.json ./

# Устанавливаем ВСЕ зависимости (npm ci если есть lock, иначе npm install)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Копируем исходный код
COPY . .

# Собираем TypeScript в JavaScript
RUN npm run build

# Проверяем что сборка прошла успешно
RUN ls -la dist/ && ls -la dist/server/

# ===========================================
# STAGE 2: Production
# ===========================================
FROM node:22-alpine AS production

WORKDIR /app

# Установка runtime зависимостей
RUN apk add --no-cache \
    curl \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    font-noto \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    # Runtime библиотеки для canvas (без dev версий)
    cairo \
    pango \
    libjpeg-turbo \
    giflib \
    librsvg \
    pixman \
    && fc-cache -fv

# Переменные окружения
ENV NODE_ENV=production \
    PORT=5000 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Копируем package files
COPY package*.json ./

# Устанавливаем ТОЛЬКО production зависимости
RUN npm ci --omit=dev && npm cache clean --force

# Копируем собранный код из builder stage
COPY --from=builder /app/dist ./dist

# Создаем необходимые директории
RUN mkdir -p uploads/temp uploads/processed uploads/videos logs \
    && chown -R node:node /app

# Запускаем от непривилегированного пользователя
USER node

# Открываем порт
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Запуск приложения
CMD ["node", "dist/server/index.js"]
