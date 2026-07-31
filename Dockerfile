# Стадия 1: Сборка приложения
FROM node:22-alpine AS builder

WORKDIR /app

# SHA коммита, из которого собран образ (AI-50). Прокидывается deploy-скриптом.
ARG APP_COMMIT_SHA=unknown

# VITE_ переменные встраиваются во время сборки — передаём через ARG
ARG VITE_PLAN_PRICE_PRO
ARG VITE_PLAN_PRICE_PRO_ORIGINAL
ARG VITE_PLAN_PRICE_BASIC
ARG VITE_PLAN_PRICE_BASIC_ORIGINAL
ENV VITE_PLAN_PRICE_PRO=$VITE_PLAN_PRICE_PRO
ENV VITE_PLAN_PRICE_PRO_ORIGINAL=$VITE_PLAN_PRICE_PRO_ORIGINAL
ENV VITE_PLAN_PRICE_BASIC=$VITE_PLAN_PRICE_BASIC
ENV VITE_PLAN_PRICE_BASIC_ORIGINAL=$VITE_PLAN_PRICE_BASIC_ORIGINAL

# Копируем package files
COPY package*.json ./

# Заменяем Replit-внутренний реестр на публичный npm перед установкой
RUN sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json

# Устанавливаем ВСЕ зависимости (включая dev для сборки)
RUN npm install --registry https://registry.npmjs.org

# Копируем исходный код
COPY . .

# Собираем приложение (frontend + backend)
RUN npm run build

# Стадия 2: Production образ
FROM node:22-alpine

WORKDIR /app

# Устанавливаем FFmpeg, Chromium и зависимости для Puppeteer
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    font-noto \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    && fc-cache -fv

# Настраиваем Puppeteer для использования системного Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Устанавливаем кодировку UTF-8
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV NODE_ENV=production

# Provenance: тот же SHA доступен приложению (его отдаёт /health) и висит
# меткой на образе. Так «уехал ли код на прод» проверяется полем, а не
# грепом ASCII-маркеров по бандлу.
ARG APP_COMMIT_SHA=unknown
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
LABEL org.opencontainers.image.revision=$APP_COMMIT_SHA

# Копируем package files и устанавливаем ТОЛЬКО production зависимости
COPY package*.json ./
RUN sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
RUN npm install --omit=dev --registry https://registry.npmjs.org && \
    npm install @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe --omit=dev --registry https://registry.npmjs.org

# Копируем собранные файлы из builder стадии
COPY --from=builder /app/dist ./dist

# Копируем необходимые файлы для runtime
COPY --from=builder /app/client/public ./client/public
COPY --from=builder /app/smmniap_static ./smmniap_static

# Создаем необходимые директории
RUN mkdir -p uploads/temp uploads/processed uploads/videos logs

# Настраиваем права доступа
RUN chown -R node:node /app

USER node
EXPOSE 5000

# Запускаем production сервер
CMD ["npm", "run", "start"]