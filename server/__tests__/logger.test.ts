/**
 * Контракт логгера (docs/LOGGING-PLAN.md, этап 1).
 *
 * До этого тест фиксировал ровно то поведение, из-за которого прод молчал:
 * «should filter messages in production» ожидал, что log(..., 'error') в
 * production не печатается, а «systemError should only show in development» —
 * что системная ошибка в проде беззвучна. Обе проверки описывали баг как норму.
 *
 * Новый контракт: error/warn/info видны всегда, debug — только при
 * LOG_LEVEL=debug, глушения по тексту сообщения не существует.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    log, logMessage, info, error, warn, debug, criticalError, systemError,
    logEnvironmentInfo, refreshEnvironmentConfig, getRecentLogs,
} from '../utils/logger';
import * as envDetector from '../utils/environment-detector';

// Фабрика мока поднимается наверх, поэтому значение по умолчанию задаём прямо
// здесь: logger читает окружение на этапе импорта модуля.
vi.mock('../utils/environment-detector', () => ({
    detectEnvironment: vi.fn().mockReturnValue({
        environment: 'development',
        verboseLogs: true,
        debugScheduler: true,
        logLevel: 'debug',
        directusUrl: 'http://test',
    }),
}));

const DEV = {
    environment: 'development',
    verboseLogs: true,
    debugScheduler: true,
    logLevel: 'debug',
    directusUrl: 'http://test',
};

const PROD = {
    environment: 'production',
    verboseLogs: false,
    debugScheduler: false,
    logLevel: 'info',
    directusUrl: 'http://test',
};

function useEnv(cfg: Record<string, unknown>) {
    (envDetector.detectEnvironment as any).mockReturnValue(cfg);
    refreshEnvironmentConfig();
}

describe('logger', () => {
    let consoleSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (envDetector.detectEnvironment as any).mockReturnValue(DEV);
        refreshEnvironmentConfig();

        consoleSpy = {
            log: vi.spyOn(console, 'log').mockImplementation(() => { }),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => { }),
            error: vi.spyOn(console, 'error').mockImplementation(() => { }),
        };
    });

    describe('уровни в production', () => {
        it('ошибка печатается, даже если текст раньше был в списке подавления', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            log('Request failed with status code 403', 'directus', 'error');

            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
            expect(String(consoleSpy.error.mock.calls[0][0])).toContain('403');
        });

        it('предупреждение печатается', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            warn('ECONNREFUSED, ушли в фолбэк', 'scraper');

            expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
        });

        it('info печатается — это итоги, а не мусор', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            info('[VK-CHECK] Статус: активных=3, истёкших=0', 'vk-cron');

            expect(consoleSpy.log).toHaveBeenCalledTimes(1);
        });

        it('debug не печатается при уровне info', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            debug('scraper request={...}', 'analytics');

            expect(consoleSpy.log).not.toHaveBeenCalled();
        });

        it('debug печатается, если LOG_LEVEL=debug', () => {
            useEnv({ ...PROD, logLevel: 'debug' });
            vi.clearAllMocks();

            debug('scraper request={...}', 'analytics');

            expect(consoleSpy.log).toHaveBeenCalledTimes(1);
        });

        it('уровень warn отсекает info, но не ошибки', () => {
            useEnv({ ...PROD, logLevel: 'warn' });
            vi.clearAllMocks();

            info('итог цикла', 'cron');
            expect(consoleSpy.log).not.toHaveBeenCalled();

            error('цикл упал', new Error('boom'), 'cron');
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('формат в production — одна строка JSON', () => {
        beforeEach(() => {
            useEnv(PROD);
            vi.clearAllMocks();
        });

        it('строка разбирается как JSON и несёт уровень с источником', () => {
            info('кампания опубликована', 'publish');

            const line = String(consoleSpy.log.mock.calls[0][0]);
            expect(line).not.toContain('\n');
            const parsed = JSON.parse(line);
            expect(parsed).toMatchObject({ level: 'info', source: 'publish', msg: 'кампания опубликована' });
            expect(typeof parsed.ts).toBe('string');
        });

        it('у ошибки видны статус и тело ответа, а не только текст axios', () => {
            const axiosErr: any = new Error('Request failed with status code 403');
            axiosErr.response = { status: 403, data: { errors: [{ message: 'no permission for field "title"' }] } };

            error('не удалось прочитать кампании', axiosErr, 'vk-cron');

            const parsed = JSON.parse(String(consoleSpy.error.mock.calls[0][0]));
            expect(parsed.err.status).toBe(403);
            expect(JSON.stringify(parsed.err.body)).toContain('no permission');
        });

        it('секреты режутся по имени поля на любой глубине', () => {
            const err: any = new Error('auth failed');
            err.response = {
                status: 401,
                data: { access_token: 'super-secret', nested: { clientSecret: 'also-secret', ok: 'visible' } },
            };

            error('отказ авторизации', err, 'directus');

            const line = String(consoleSpy.error.mock.calls[0][0]);
            expect(line).not.toContain('super-secret');
            expect(line).not.toContain('also-secret');
            expect(line).toContain('visible');
            expect(line).toContain('[REDACTED]');
        });

        it('циклическая ссылка не роняет логгер', () => {
            const err: any = new Error('loop');
            const cyclic: any = { a: 1 };
            cyclic.self = cyclic;
            err.response = { status: 500, data: cyclic };

            expect(() => error('циклическая структура', err, 'test')).not.toThrow();
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('в development формат остаётся человекочитаемым', () => {
        it('log печатает источник и сообщение', () => {
            log('test message', 'test-source');
            expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[test-source] test message'));
        });

        it('logMessage без уровня считается info', () => {
            logMessage('без уровня', 'src');
            expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[src] без уровня'));
        });

        it('warn идёт в console.warn', () => {
            warn('warn message', 'source');
            expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('[source] warn message'));
        });

        it('error идёт в console.error и отдаёт объект ошибки вторым аргументом', () => {
            const err = new Error('boom');
            error('error message', err, 'source');
            expect(consoleSpy.error).toHaveBeenCalled();
            expect(consoleSpy.error.mock.calls[0][1]).toBe(err);
        });
    });

    describe('criticalError и systemError', () => {
        it('criticalError помечен как критический и виден в проде', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            criticalError('DB DOWN', 'db');

            const parsed = JSON.parse(String(consoleSpy.error.mock.calls[0][0]));
            expect(parsed.level).toBe('fatal');
            expect(parsed.msg).toContain('КРИТИЧЕСКАЯ ОШИБКА');
        });

        it('systemError теперь виден и в production', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            systemError('очередь публикаций не поднялась');

            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('буфер последних логов', () => {
        it('наполняется тем, что реально напечатано', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            info('строка для буфера', 'test');

            expect(getRecentLogs().some(l => l.includes('строка для буфера'))).toBe(true);
        });

        it('не хранит отфильтрованный debug', () => {
            useEnv(PROD);
            vi.clearAllMocks();

            debug('это не должно попасть в буфер', 'test');

            expect(getRecentLogs().some(l => l.includes('не должно попасть'))).toBe(false);
        });
    });

    describe('logEnvironmentInfo', () => {
        it('сообщает режим работы', () => {
            logEnvironmentInfo();
            expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Running in development mode'));
        });
    });
});
