/**
 * AI-101 Phase 2B: запрос к Telegram уходит через транспорт, а не мимо него.
 *
 * Сторож покрытия проверяет ТЕКСТ файлов — он поймает двадцать первый вызов,
 * дописанный завтра. Здесь проверяется исполнение: клиент, который реально
 * получил запрос. Одно без другого дырявое: текст можно обойти, а поведение
 * проверяется только там, куда дотягивается тест.
 *
 * Два семейства из пяти покрыты здесь (проверка настроек и уведомления
 * пользователю) — те, что вызываются напрямую и не требуют поднимать роутер.
 * Семейство платежей проверяется в `yookassa-activation-idempotency.test.ts`:
 * там двойник Telegram переехал с fetch на транспорт вместе с кодом, и счётчик
 * уведомлений считает именно вызовы транспорта. Остальные два семейства
 * (заявки на подписку и бот) на сегодня держит сторож покрытия.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

const tgPost = vi.hoisted(() => vi.fn());
const tgGet = vi.hoisted(() => vi.fn());

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: async () => ({ post: tgPost, get: tgGet }),
}));

vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Phase 2B: проверка токена бота идёт через транспорт', () => {
  it('getMe уходит транспортом, голый axios не зовётся', async () => {
    tgGet.mockResolvedValueOnce({ data: { ok: true, result: { first_name: 'Бот', username: 'bot' } } });

    const { validateTelegramToken } = await import('../services/social-api-validator');
    const res = await validateTelegramToken('TESTTOKEN');

    expect(res.isValid).toBe(true);
    expect(tgGet).toHaveBeenCalledTimes(1);
    // URL и таймаут прежние — перевод менял клиент, а не запрос.
    expect(tgGet.mock.calls[0][0]).toBe('https://api.telegram.org/botTESTTOKEN/getMe');
    expect(tgGet.mock.calls[0][1]).toEqual({ timeout: 10000 });
    // Свидетель: мимо транспорта не ушло ничего.
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe('Phase 2B: уведомление пользователю идёт через транспорт', () => {
  it('sendMessage уходит транспортом на каждую сессию, голый axios только за сессиями', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'BOTTOKEN';
    process.env.DIRECTUS_URL = 'https://directus.local';
    process.env.DIRECTUS_STATIC_TOKEN = 'admin';

    // Список сессий читается из Directus — это НЕ Telegram, здесь axios законен.
    mockedAxios.get.mockResolvedValueOnce({ data: { data: [{ chat_id: 111 }, { chat_id: 222 }] } } as any);
    tgPost.mockResolvedValue({ data: { ok: true } });

    const { notifyUser } = await import('../services/notify-user');
    const channel = await notifyUser({ userId: 'user-1', telegramText: 'привет' } as any);

    expect(channel).toBe('telegram');
    expect(tgPost).toHaveBeenCalledTimes(2);
    expect(tgPost.mock.calls[0][0]).toBe('https://api.telegram.org/botBOTTOKEN/sendMessage');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
