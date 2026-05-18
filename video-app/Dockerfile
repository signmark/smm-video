FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx vite build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    font-noto \
    && fc-cache -fv

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/vite.config.ts ./vite.config.ts

RUN mkdir -p data/videos data/images

RUN chown -R node:node /app
USER node

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
