/**
 * Хелпер: мок для `log` (вызываемая функция с методами).
 *
 * ЗАЧЕМ: в AI-132 slice 1 (запись) сторож пишет в `log.error` —
 * чтобы в проде проверить, что сообщение идёт в журнал, а в
 * тесте — что не бросает, мы перехватываем записи. Готовый мок
 * должен быть:
 *  1) вызываемой функцией (прод-код зовёт `log(...)` как функцию);
 *  2) иметь методы `.error`, `.warn`, `.info`, `.debug`, `.event`.
 *
 * Подключение: `vi.mock('../utils/logger', () => makeLoggerMock())`
 * возвращает модуль с экспортом `log`.
 *
 * Использование:
 *   import { loggerSpy } from './helpers/logger-mock';
 *   loggerSpy.error.mockClear();
 *   expect(loggerSpy.error).toHaveBeenCalledWith(expect.stringMatching(/\[schema-guard\]/));
 */
import { vi } from 'vitest';

const errorFn = vi.fn();
const warnFn = vi.fn();
const infoFn = vi.fn();
const debugFn = vi.fn();
const eventFn = vi.fn();
const logEventFn = vi.fn();
const logFn: any = vi.fn();
logFn.error = errorFn;
logFn.warn = warnFn;
logFn.info = infoFn;
logFn.debug = debugFn;
logFn.event = eventFn;
// AI-65: фактическое имя экспорта в logger.ts — `logEvent`.
logFn.logEvent = logEventFn;

export const loggerSpy = {
  error: errorFn,
  warn: warnFn,
  info: infoFn,
  debug: debugFn,
  event: eventFn,
  logEvent: logEventFn,
};

/**
 * Возвращает объект модуля для `vi.mock(factory)`.
 * Импортировать так: `vi.mock('../utils/logger', () => makeLoggerMock())`.
 */
export function makeLoggerMock() {
  return { log: logFn, logEvent: logEventFn };
}
