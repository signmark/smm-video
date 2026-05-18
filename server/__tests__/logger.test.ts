import { describe, it, expect, vi, beforeEach } from 'vitest';
import { log, info, error, warn, debug, criticalError, systemError, logEnvironmentInfo, refreshEnvironmentConfig } from '../utils/logger';
import * as envDetector from '../utils/environment-detector';

vi.mock('../utils/environment-detector', () => ({
    detectEnvironment: vi.fn().mockReturnValue({
        environment: 'development',
        verboseLogs: true,
        debugScheduler: true,
        logLevel: 'info',
        directusUrl: 'http://test'
    })
}));

describe('logger', () => {
    let consoleSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset to default development state for each test
        (envDetector.detectEnvironment as any).mockReturnValue({
            environment: 'development',
            verboseLogs: true,
            debugScheduler: true,
            logLevel: 'info',
            directusUrl: 'http://test'
        });
        refreshEnvironmentConfig();

        consoleSpy = {
            log: vi.spyOn(console, 'log').mockImplementation(() => { }),
            info: vi.spyOn(console, 'info').mockImplementation(() => { }),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => { }),
            error: vi.spyOn(console, 'error').mockImplementation(() => { }),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => { }),
        };
    });

    describe('logMessage (via log)', () => {
        it('should log in development with global debug enabled', () => {
            log('test message', 'test-source');
            expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[test-source] test message'));
        });

        it('should filter messages in production', () => {
            (envDetector.detectEnvironment as any).mockReturnValue({
                environment: 'production',
                verboseLogs: false
            });
            refreshEnvironmentConfig();
            vi.clearAllMocks();

            log('Unauthorized access', 'auth', 'error');
            expect(consoleSpy.log).not.toHaveBeenCalled();
        });

        it('should show critical errors in production', () => {
            (envDetector.detectEnvironment as any).mockReturnValue({
                environment: 'production',
                verboseLogs: false
            });
            refreshEnvironmentConfig();

            log('FATAL ERROR: DB DOWN', 'db', 'error');
            expect(consoleSpy.log).toHaveBeenCalled();
        });
    });

    describe('helper methods', () => {
        it('info should log message', () => {
            info('info message', 'source');
            expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[source] info message'));
        });

        it('warn should log message', () => {
            warn('warn message', 'source');
            expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('[source] warn message'));
        });

        it('error should log message and error object', () => {
            const err = new Error('boom');
            error('error message', err, 'source');
            expect(consoleSpy.error).toHaveBeenCalled();
        });

        it('debug should log message', () => {
            debug('debug message', 'source');
            expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringContaining('[source] debug message'));
        });
    });

    describe('criticalError and systemError', () => {
        it('criticalError should always show with specific formatting', () => {
            criticalError('CRITICAL', 'sys');
            expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('КРИТИЧЕСКАЯ ОШИБКА'));
        });

        it('systemError should only show in development', () => {
            (envDetector.detectEnvironment as any).mockReturnValue({ environment: 'production' });
            refreshEnvironmentConfig();
            systemError('SYSTEM');
            expect(consoleSpy.error).not.toHaveBeenCalled();

            (envDetector.detectEnvironment as any).mockReturnValue({ environment: 'development' });
            refreshEnvironmentConfig();
            systemError('SYSTEM');
            expect(consoleSpy.error).toHaveBeenCalled();
        });
    });

    describe('logEnvironmentInfo', () => {
        it('should log basic env info', () => {
            logEnvironmentInfo();
            expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Running in development mode'));
        });
    });
});
