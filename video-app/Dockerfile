FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --registry https://registry.npmjs.org

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
RUN npm install --omit=dev --registry https://registry.npmjs.org

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/vite.config.ts ./vite.config.ts

RUN mkdir -p data/videos data/images server/assets/previews

# Generate voice preview MP3s during build (Edge TTS, no API key needed)
RUN node scripts/gen-previews.mjs && rm -rf scripts

RUN chown -R node:node /app
USER node

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
