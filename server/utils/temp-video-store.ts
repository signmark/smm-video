/**
 * Временное хранилище видео-буферов для проксирования в Threads API.
 * Meta серверы не могут получить доступ к российским S3 хранилищам (beget.cloud и др.)
 * Видео скачивается на наш сервер и отдаётся Threads по нашему публичному URL.
 */

interface TempVideoEntry {
  buffer: Buffer;
  contentType: string;
  expires: number;
}

const store = new Map<string, TempVideoEntry>();

const TTL_MS = 30 * 60 * 1000; // 30 минут — Threads API долго обрабатывает видео

export function storeTempVideo(id: string, buffer: Buffer, contentType = 'video/mp4'): void {
  store.set(id, {
    buffer,
    contentType,
    expires: Date.now() + TTL_MS
  });
}

export function getTempVideo(id: string): TempVideoEntry | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(id);
    return undefined;
  }
  return entry;
}

export function deleteTempVideo(id: string): void {
  store.delete(id);
}

// Очистка просроченных записей каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now > entry.expires) store.delete(id);
  }
}, 5 * 60 * 1000);
