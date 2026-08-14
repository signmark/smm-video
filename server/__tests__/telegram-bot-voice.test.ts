/**
 * AI-111: голосовое сообщение боту.
 *
 * Обработчик звал `speechToTextService.transcribeAudioFromUrl(...)` — метода с
 * таким именем в сервисе нет. У живого человека это падало TypeError ДО всякого
 * скачивания: бот отвечал «Ошибка при обработке… is not a function» и на этом
 * заканчивал. Полный серверный `tsc` эту ошибку видит (TS2551), но храповик
 * следит только за тем, чтобы ошибок не становилось больше.
 *
 * Почему тест идёт через настоящий обработчик, а не через отдельную функцию.
 * Дефект жил именно в связке «обработчик → сервис»: имя метода, порядок
 * аргументов, тип первого аргумента. Тест на выделенный кусок эту связку и не
 * проверял бы — он проверял бы то, что я сам только что написал. Поэтому здесь
 * поднимается настоящий `TelegramBotService` с подменёнными зависимостями, из
 * него достаётся обработчик голосовых, зарегистрированный в `setupHandlers`,
 * и вызывается так, как его вызвал бы Telegraf.
 *
 * Red-before (проверено на коде до правки): падают все проверки распознавания —
 * ровно на `transcribeAudioFromUrl is not a function`, а не на импорте и не на
 * заглушках; заглушки и импорт при этом отрабатывают, что видно по ответу
 * «Обрабатываю голосовое сообщение…».
 *
 * Чего тест НЕ делает: не ходит в сеть, не шлёт живых сообщений, не поднимает
 * long polling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import axios from 'axios';

// --- подмены ---------------------------------------------------------------

const tgGet = vi.hoisted(() => vi.fn());
const transcribeAudio = vi.hoisted(() => vi.fn());

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: async () => ({ get: tgGet }),
  getTelegramAgent: () => ({}),
}));

vi.mock('../services/speech-to-text', () => ({
  speechToTextService: { transcribeAudio },
}));

// Фильтры Telegraf возвращают объект-предикат; для теста достаточно, чтобы
// регистрация была узнаваема по имени события.
vi.mock('telegraf/filters', () => ({ message: (kind: string) => kind }));

const handlers = vi.hoisted(() => new Map<string, Function>());
const telegramApi = vi.hoisted(() => ({
  getFile: vi.fn(),
  deleteMyCommands: vi.fn(async () => {}),
  setMyCommands: vi.fn(async () => {}),
  sendMessage: vi.fn(async () => ({})),
}));

vi.mock('telegraf', () => {
  class Telegraf {
    telegram = telegramApi;
    on(kind: string, handler: Function) { handlers.set(kind, handler); }
    use() {}
    command() {}
    start() {}
    action() {}
    catch() {}
    launch() { return new Promise(() => {}); }
    stop() {}
  }
  return {
    Telegraf,
    Context: class {},
    Markup: {
      inlineKeyboard: (b: unknown) => ({ reply_markup: { inline_keyboard: b } }),
      button: { callback: (t: string, d: string) => ({ text: t, callback_data: d }) },
      keyboard: () => ({ resize: () => ({}) }),
      removeKeyboard: () => ({}),
    },
  };
});

vi.mock('../services/telegram-session-storage', () => ({
  telegramSessionStorage: {
    getAllSessions: vi.fn(async () => []),
    checkCollection: vi.fn(async () => false),
    saveSession: vi.fn(async () => {}),
    getSession: vi.fn(async () => null),
    deleteSession: vi.fn(async () => {}),
  },
}));

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: { getAuthToken: vi.fn(async () => null) },
}));

vi.mock('../services/apply-subscription', () => ({ applySubscription: vi.fn() }));
vi.mock('../routes/subscriptions', () => ({
  markSubscriptionProcessed: vi.fn(),
  getSubscriptionStatus: vi.fn(async () => null),
}));

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Слушатель обновления токенов вешается прямо в конструкторе.
(global as any).directusEventEmitter = new EventEmitter();

// --- обвязка ---------------------------------------------------------------

const АУДИО = Buffer.from('фиктивные байты ogg');
// `responseType: 'arraybuffer'` отдаёт именно ArrayBuffer, а не Buffer. Если
// подсунуть здесь готовый Buffer, тест перестанет замечать пропажу
// `Buffer.from(...)` — а сервис распознавания ждёт настоящий Buffer.
const АУДИО_СЫРЬЁМ = АУДИО.buffer.slice(АУДИО.byteOffset, АУДИО.byteOffset + АУДИО.byteLength);
const ФАЙЛ = 'voice/file_123.oga';
const ССЫЛКА = `https://api.telegram.org/file/botTESTTOKEN/${ФАЙЛ}`;

type Ответ = { текст: string; опции?: unknown };

async function запустить(voice: Record<string, unknown>) {
  const { TelegramBotService } = await import('../telegram-bot/index');
  const bot: any = new TelegramBotService('TESTTOKEN');
  // Ассистент — отдельный путь, сюда он не относится: подменяем, чтобы тест не
  // уходил в генерацию ответа.
  bot.askAssistant = vi.fn(async () => {});

  const ответы: Ответ[] = [];
  const ctx: any = {
    chat: { id: 42 },
    from: { id: 42 },
    session: { token: 'сессия-есть', userId: 'user-1' },
    message: { voice },
    telegram: telegramApi,
    reply: vi.fn(async (текст: string, опции?: unknown) => { ответы.push({ текст, опции }); return {}; }),
  };

  const handler = handlers.get('voice');
  expect(handler, 'обработчик голосовых не зарегистрирован').toBeTypeOf('function');
  await handler!(ctx);

  return { bot, ctx, ответы, всё: ответы.map(о => о.текст).join('\n') };
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  process.env.TELEGRAM_BOT_TOKEN = 'TESTTOKEN';
  telegramApi.getFile.mockResolvedValue({ file_path: ФАЙЛ });
  tgGet.mockResolvedValue({ data: АУДИО_СЫРЬЁМ });
  transcribeAudio.mockResolvedValue('привет, это распознанный текст');
});

afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------------------

describe('AI-111: голосовое доходит до распознавания', () => {
  it('обработчик зовёт существующий метод сервиса и показывает человеку текст', async () => {
    const { ответы, всё, bot } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(всё).toContain('привет, это распознанный текст');
    expect(всё).toContain('Распознано');
    // Текст уходит дальше в ассистента — прежнее поведение обработчика.
    expect(bot.askAssistant).toHaveBeenCalledWith(expect.anything(), 'привет, это распознанный текст');
    // Ни один ответ не должен быть отказом.
    expect(ответы.some(о => о.текст.includes('❌'))).toBe(false);
  });

  it('в сервис уходит именно буфер с байтами файла и mime из сообщения', async () => {
    await запустить({ file_id: 'f1', mime_type: 'audio/opus' });

    const [буфер, mime] = transcribeAudio.mock.calls[0];
    expect(Buffer.isBuffer(буфер), 'первым аргументом обязан быть Buffer, а не ссылка').toBe(true);
    expect(Buffer.from(буфер).equals(АУДИО)).toBe(true);
    expect(mime).toBe('audio/opus');
    // Ссылка с токеном бота наружу, в сервис распознавания, не уходит.
    expect(transcribeAudio.mock.calls[0].some((а: unknown) => typeof а === 'string' && а.includes('api.telegram.org'))).toBe(false);
  });

  it('без mime в сообщении берётся значение по умолчанию', async () => {
    await запустить({ file_id: 'f1' });
    expect(transcribeAudio.mock.calls[0][1]).toBe('audio/ogg');
  });
});

describe('AI-111: файл качается общим транспортом, а не мимо него', () => {
  it('скачивание идёт через транспорт, голый axios не зовётся', async () => {
    await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    expect(tgGet).toHaveBeenCalledTimes(1);
    expect(tgGet.mock.calls[0][0]).toBe(ССЫЛКА);
    expect(tgGet.mock.calls[0][1]).toMatchObject({ responseType: 'arraybuffer' });
    // Свидетель обхода: мимо транспорта не ушло ничего.
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect((mockedAxios as any).mock?.calls ?? []).toHaveLength(0);
  });
});

describe('AI-111: отказы человек видит словами', () => {
  const осмысленно = (текст: string) => {
    expect(текст).not.toContain('[object Object]');
    expect(текст).not.toContain('undefined');
    expect(текст.replace(/[^\p{L}]/gu, '').length, `пустой отказ: ${JSON.stringify(текст)}`).toBeGreaterThan(10);
  };

  it('файл не скачался — отказ понятен и распознавание не зовётся', async () => {
    tgGet.mockRejectedValueOnce(new Error('соединение оборвалось'));
    const { ответы } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    // Свидетель того, что дошли ИМЕННО до скачивания: без него проверка была бы
    // зелёной и на старом дефекте — там отказ тоже виден, только он про
    // несуществующий метод.
    expect(tgGet).toHaveBeenCalledTimes(1);
    const отказ = ответы.map(о => о.текст).find(т => т.includes('❌'));
    expect(отказ, 'человеку не сказали, что пошло не так').toBeTruthy();
    осмысленно(отказ!);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('распознавание отказало — отказ понятен, текст в ассистента не уходит', async () => {
    transcribeAudio.mockRejectedValueOnce(new Error('Gemini вернул пустой ответ'));
    const { ответы, bot } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    // Дошли до распознавания, а не упали раньше.
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    // И НЕ качаем файл заново: отказ распознавания не повод ходить в Telegram
    // второй раз.
    expect(tgGet).toHaveBeenCalledTimes(1);
    const отказ = ответы.map(о => о.текст).find(т => т.includes('❌'));
    expect(отказ).toBeTruthy();
    осмысленно(отказ!);
    expect(bot.askAssistant).not.toHaveBeenCalled();
  });

  it('во внутренней поломке человеку не показывают имя метода', async () => {
    // Ошибка программиста (TypeError) человеку ничего не объясняет, а имя
    // внутреннего метода в чате — лишнее. Причина при этом остаётся в журнале.
    const журнал = vi.spyOn(console, 'error').mockImplementation(() => {});
    transcribeAudio.mockImplementationOnce(() => { throw new TypeError('speechToTextService.somethingInternal is not a function'); });
    const { ответы } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    const отказ = ответы.map(о => о.текст).find(т => т.includes('❌'))!;
    expect(отказ).toBeTruthy();
    осмысленно(отказ);
    expect(отказ).not.toContain('is not a function');
    expect(отказ).not.toContain('somethingInternal');
    // Свидетель: исходная причина не потеряна, она ушла в журнал сервера.
    expect(JSON.stringify(журнал.mock.calls)).toContain('somethingInternal');
    журнал.mockRestore();
  });

  it('отказ без текста ошибки всё равно читается человеком', async () => {
    // Отказ без message — обычное дело у сетевых обёрток; человеку нельзя
    // показывать пустоту или «undefined».
    tgGet.mockRejectedValueOnce({ code: 'ECONNRESET' });
    const { ответы } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    expect(tgGet).toHaveBeenCalledTimes(1);
    const отказ = ответы.map(о => о.текст).find(т => т.includes('❌'));
    expect(отказ).toBeTruthy();
    осмысленно(отказ!);
  });

  it('в тексте отказа нет токена бота, хотя он есть в ссылке на файл', async () => {
    // Сетевая ошибка обычно несёт в себе URL запроса, а в нём — токен бота.
    // Показать такой текст человеку значит отдать токен в чат.
    tgGet.mockRejectedValueOnce(new Error(`Request failed for ${ССЫЛКА}`));
    const { всё } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    // Без этого свидетеля проверка была бы зелёной и на старом дефекте: там
    // скачивания не было вовсе, а значит и токену взяться было неоткуда.
    expect(tgGet).toHaveBeenCalledTimes(1);
    expect(всё).not.toContain('TESTTOKEN');
    expect(всё).not.toContain('botTESTTOKEN');
  });

  it('пустое распознавание — прежний ответ, в ассистента ничего не уходит', async () => {
    transcribeAudio.mockResolvedValueOnce('   ');
    const { всё, bot } = await запустить({ file_id: 'f1', mime_type: 'audio/ogg' });

    expect(всё).toContain('Не удалось распознать речь');
    expect(bot.askAssistant).not.toHaveBeenCalled();
  });
});
