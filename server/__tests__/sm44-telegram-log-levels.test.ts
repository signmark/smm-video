/**
 * SM-44 ч.4: Telegram-bot log levels — executable path-level guards.
 *
 * Проверяет через реальные вызовы production-функций:
 * 1. Routine startup/session/GET-TOKEN точки пишут debug
 * 2. Failure/security пути сохраняют warn/error
 * 3. Sensitive значения отсутствуют в debug
 * 4. Cleanup даёт ровно одну агрегированную запись с count/duration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Capture log output ----------------------------------------------------

const logCalls: Array<{ level: string; message: string }> = [];
const consoleCalls: Array<{ level: string; args: any[] }> = [];
const origConsoleError = console.error;
const origConsoleWarn = console.warn;
const origConsoleLog = console.log;

// --- подмены ----------------------------------------------------------------

const mockGetAllSessions = vi.fn();
const mockDeleteSession = vi.fn();
const mockSaveSession = vi.fn();
const mockGetSession = vi.fn();
const mockLoadSessionsFromDB = vi.fn();
const mockGetValidToken = vi.fn();
const mockGetAuthToken = vi.fn();
const mockCheckCollection = vi.fn(async () => false);

vi.mock('../services/telegram-session-storage', () => ({
  telegramSessionStorage: {
    getAllSessions: mockGetAllSessions,
    deleteSession: mockDeleteSession,
    saveSession: mockSaveSession,
    getSession: mockGetSession,
    checkCollection: mockCheckCollection,
  },
}));

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    loadSessionsFromDB: mockLoadSessionsFromDB,
    getValidToken: mockGetValidToken,
    getAuthToken: mockGetAuthToken,
  },
}));

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: { sendMessage: vi.fn() },
  getTelegramAgent: vi.fn(() => ({ token: 'test-bot-token' })),
}));

vi.mock('../services/apply-subscription', () => ({ applySubscription: vi.fn() }));
vi.mock('../routes/subscriptions', () => ({
  markSubscriptionProcessed: vi.fn(),
  getSubscriptionStatus: vi.fn(async () => null),
}));

vi.mock('telegraf/filters', () => ({ message: (kind: string) => kind }));

const handlers = vi.hoisted(() => new Map<string, Function>());
const telegramApi = vi.hoisted(() => ({
  setMyCommands: vi.fn(async () => {}),
  sendMessage: vi.fn(async () => ({})),
  callApi: vi.fn(async () => true),
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

vi.mock('axios');

(global as any).directusEventEmitter = new EventEmitter();

// Logger mock — must be callable + have debug/info/warn/error
vi.mock('../utils/logger', () => ({
  log: Object.assign(
    vi.fn((msg: string) => logCalls.push({ level: 'info', message: msg })),
    {
      debug: vi.fn((msg: string) => logCalls.push({ level: 'debug', message: msg })),
      info: vi.fn((msg: string) => logCalls.push({ level: 'info', message: msg })),
      warn: vi.fn((msg: string) => logCalls.push({ level: 'warn', message: msg })),
      error: vi.fn((msg: string) => logCalls.push({ level: 'error', message: msg })),
    }
  ),
  logEvent: vi.fn(),
  error: vi.fn((msg: string) => logCalls.push({ level: 'error', message: msg })),
  warn: vi.fn((msg: string) => logCalls.push({ level: 'warn', message: msg })),
  info: vi.fn((msg: string) => logCalls.push({ level: 'info', message: msg })),
  debug: vi.fn((msg: string) => logCalls.push({ level: 'debug', message: msg })),
}));

// --- helpers ----------------------------------------------------------------

async function createBot() {
  const { TelegramBotService } = await import('../telegram-bot/index');
  return new TelegramBotService('TESTTOKEN') as any;
}

// --- tests ------------------------------------------------------------------

describe('SM-44 ч.4: Telegram-bot log levels', () => {
  beforeEach(() => {
    logCalls.length = 0;
    consoleCalls.length = 0;
    handlers.clear();
    vi.clearAllMocks();
    console.error = (...args: any[]) => consoleCalls.push({ level: 'error', args });
    console.warn = (...args: any[]) => consoleCalls.push({ level: 'warn', args });
    console.log = (...args: any[]) => consoleCalls.push({ level: 'log', args });
  });
  afterEach(() => {
    console.error = origConsoleError;
    console.warn = origConsoleWarn;
    console.log = origConsoleLog;
  });

  describe('1. Routine startup/session → debug', () => {
    it('session load from DB writes debug (not info) for loaded count', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 't1', refresh_token: 'rt1', email: 'a@b.c', first_name: 'A', last_name: 'B', session_data: {} },
      ]);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      const bot = await createBot();
      // loadAllSessionsFromDB is called during construction via init()
      // Wait for async init
      await new Promise(r => setTimeout(r, 50));

      const debugMsgs = logCalls.filter(c =>
        c.level === 'debug' && c.message.includes('Загружено') && c.message.includes('сессий')
      );
      expect(debugMsgs.length).toBe(1);
      expect(debugMsgs[0].message).toContain('1');
    });

    it('loadSessionsFromDB called during startup', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 't1', refresh_token: 'rt1', email: 'a@b.c', first_name: 'A', last_name: 'B', session_data: {} },
      ]);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      // loadSessionsFromDB should be called
      expect(mockLoadSessionsFromDB).toHaveBeenCalled();
    });
  });

  describe('2. Failure/security paths preserve warn/error', () => {
    it('session load failure writes error (not debug)', async () => {
      mockGetAllSessions.mockRejectedValue(new Error('DB connection failed'));

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      // Error path uses console.error (not converted — correct)
      const errorMsgs = consoleCalls.filter(c =>
        c.level === 'error' && c.args.some(a => typeof a === 'string' && a.includes('Ошибка загрузки сессий'))
      );
      expect(errorMsgs.length).toBe(1);
    });

    it('critical error cleanup stays at error', async () => {
      // getFreshToken catch path: getValidToken throws
      mockGetAllSessions.mockResolvedValue([]);
      mockGetValidToken.mockRejectedValue(new Error('network timeout'));

      const bot = await createBot();
      await new Promise(r => setTimeout(r, 50));

      // Actually call getFreshToken to trigger the catch path
      const ctx: any = {
        chat: { id: 42 },
        session: { userId: 'user-1', token: 'old-token', refreshToken: 'rt' },
      };
      const result = await (bot as any).getFreshToken(ctx);
      expect(result).toBeNull();

      // Capture console.error calls for the critical cleanup message
      const criticalMsgs = consoleCalls.filter(c =>
        c.level === 'error' && c.args.some(a => typeof a === 'string' && a.includes('Clearing session due to critical error'))
      );
      // Must have exactly one non-empty occurrence
      expect(criticalMsgs.length).toBe(1);
      expect(criticalMsgs[0].args.some(a => typeof a === 'string' && a.includes('user-1'))).toBe(true);
    });
  });

  describe('3. Sensitive values absent from debug output', () => {
    it('no raw tokens in debug messages', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 'secret-token-12345', refresh_token: 'rt-12345', email: 'user@example.com', first_name: 'A', last_name: 'B', session_data: {} },
      ]);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      const debugMsgs = logCalls.filter(c => c.level === 'debug');
      for (const msg of debugMsgs) {
        expect(msg.message).not.toContain('secret-token-12345');
        expect(msg.message).not.toContain('rt-12345');
        expect(msg.message).not.toMatch(/bearer\s+[a-zA-Z0-9_-]{20,}/i);
      }
    });

    it('no user emails in debug messages', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 't1', refresh_token: 'rt1', email: 'user@example.com', first_name: 'A', last_name: 'B', session_data: {} },
      ]);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      const debugMsgs = logCalls.filter(c => c.level === 'debug');
      for (const msg of debugMsgs) {
        expect(msg.message).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      }
    });
  });

  describe('4. Cleanup aggregation', () => {
    it('zero stale sessions → one debug record with count=0 and duration', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 't1', refresh_token: 'rt1', email: 'a@b.c', first_name: 'A', last_name: 'B', session_data: {} },
      ]);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      const cleanupLogs = logCalls.filter(c => c.message.includes('Session cleanup'));
      expect(cleanupLogs.length).toBe(1);
      expect(cleanupLogs[0].level).toBe('debug');
      expect(cleanupLogs[0].message).toMatch(/0 stale/);
      expect(cleanupLogs[0].message).toMatch(/\d+ms/);
    });

    it('nonzero stale sessions → one info record with count and duration', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 't1', refresh_token: null },
        { chat_id: 2, user_id: 'u2', token: 't2', refresh_token: null },
        { chat_id: 3, user_id: 'u3', token: 't3', refresh_token: 'rt3', email: 'a@b.c', first_name: 'A', last_name: 'B', session_data: {} },
      ]);
      mockDeleteSession.mockResolvedValue(undefined);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      const cleanupLogs = logCalls.filter(c => c.message.includes('Session cleanup'));
      expect(cleanupLogs.length).toBe(1);
      expect(cleanupLogs[0].level).toBe('info');
      expect(cleanupLogs[0].message).toMatch(/deleted 2 stale/);
      expect(cleanupLogs[0].message).toMatch(/\d+ms/);
    });

    it('no per-item deletion debug lines', async () => {
      mockGetAllSessions.mockResolvedValue([
        { chat_id: 1, user_id: 'u1', token: 't1', refresh_token: null },
      ]);
      mockDeleteSession.mockResolvedValue(undefined);
      mockLoadSessionsFromDB.mockResolvedValue(undefined);

      await createBot();
      await new Promise(r => setTimeout(r, 50));

      // No per-item "Удаляю устаревшую сессию" lines
      const perItemLogs = logCalls.filter(c =>
        c.message.includes('Удаляю устаревшую сессию')
      );
      expect(perItemLogs.length).toBe(0);
    });
  });
});
