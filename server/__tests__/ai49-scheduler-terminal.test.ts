/**
 * AI-49 / task #49: терминальный статус площадки не должен вечно
 * пересматриваться и печататься; классификация — по точной форме, а не по
 * подстроке «not found».
 *
 * Задокументированный дефект (данные прода): записи `partially_published`, у
 * которых все неопубликованные площадки давно `failed`, выбираются планировщиком
 * каждый проход и месяцами печатают сохранённую ошибку. Подстрока «not found»
 * дополнительно ловила TikTok «token is invalid or not found in the request»
 * в телеграммную ветку.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPublishFailure, isMalformedPlatformEntry, getPublishScheduler } from '../services/publish-scheduler';
import { isPlatformTerminal } from '../services/publication-terminal-state';

const SRC = readFileSync(join(__dirname, '..', 'services', 'publish-scheduler.ts'), 'utf-8');

describe('AI-49: классификация по точной форме, не по подстроке "not found"', () => {
  it('TikTok «token is invalid or not found in the request» НЕ считается not_found', () => {
    expect(classifyPublishFailure('token is invalid or not found in the request')).not.toBe('not_found');
  });

  it('точный Telegram «chat not found» по-прежнему not_found', () => {
    expect(classifyPublishFailure('Bad Request: chat not found')).toBe('not_found');
  });

  it('общее «не найден» (рус.) по-прежнему not_found', () => {
    expect(classifyPublishFailure('Чат не найден')).toBe('not_found');
  });
});

describe('AI-49: terminal-площадка не пересматривается и не печатается', () => {
  it('failed / published / cancelled / postUrl — всё terminal', () => {
    expect(isPlatformTerminal({ status: 'failed' })).toBe(true);
    expect(isPlatformTerminal({ status: 'published' })).toBe(true);
    expect(isPlatformTerminal({ status: 'cancelled' })).toBe(true);
    expect(isPlatformTerminal({ status: 'publish_succeeded_record_failed' })).toBe(true);
    expect(isPlatformTerminal({ postUrl: 'https://t.me/x/1' })).toBe(true);
  });

  it('pending / scheduled / publishing / quota_exceeded / неизвестный — НЕ terminal (retryable)', () => {
    expect(isPlatformTerminal({ status: 'pending' })).toBe(false);
    expect(isPlatformTerminal({ status: 'scheduled' })).toBe(false);
    expect(isPlatformTerminal({ status: 'publishing' })).toBe(false);
    expect(isPlatformTerminal({ status: 'quota_exceeded' })).toBe(false);
    expect(isPlatformTerminal({ status: 'совсем-новый-статус' })).toBe(false);
  });

  // AI-49 / замечание @Clause_Dev_Hermi: в НОВОМ назначении (предикат
  // eligible-отбора) «битая/неожиданная форма площадки → terminal» означает,
  // что вся публикация молча перестаёт быть eligible. По проду таких записей
  // сегодня ноль (штатный путь пишет объект со статусом pending/scheduled),
  // но решение стоит закрепить явно: если кто-то ослабит isPlatformTerminal
  // под разбор зависших — этот тест вернёт дефект отбора, а не промолчит.
  it('битая/неожиданная форма площадки считается terminal — запись не eligible', () => {
    expect(isPlatformTerminal(null)).toBe(true);
    expect(isPlatformTerminal(undefined)).toBe(true);
    expect(isPlatformTerminal('telegram')).toBe(true); // строка вместо объекта
    expect(isPlatformTerminal(42)).toBe(true);
    expect(isPlatformTerminal(true)).toBe(true);
  });
});

describe('AI-49 v3: битая форма площадки — fail-close + ограниченный warn', () => {
  it('isMalformedPlatformEntry: только non-object / отсутствие / массив', () => {
    expect(isMalformedPlatformEntry(null)).toBe(true);
    expect(isMalformedPlatformEntry(undefined)).toBe(true);
    expect(isMalformedPlatformEntry('x')).toBe(true);
    expect(isMalformedPlatformEntry(1)).toBe(true);
    expect(isMalformedPlatformEntry([1])).toBe(true);
    expect(isMalformedPlatformEntry([])).toBe(true); // пустой массив — тоже битая форма
    // Легитимные объекты-площадки (в т.ч. terminal-статусы) НЕ битые.
    expect(isMalformedPlatformEntry({ status: 'failed' })).toBe(false);
    expect(isMalformedPlatformEntry({ status: 'published' })).toBe(false);
    expect(isMalformedPlatformEntry({ status: 'pending' })).toBe(false);
    expect(isMalformedPlatformEntry({})).toBe(false);
  });

  it('массив — битая форма: НЕ terminal по isPlatformTerminal, но НЕ retryable по предикату', () => {
    // isPlatformTerminal пропускает массив (typeof [] === 'object'), поэтому
    // битую форму обязан ловить isMalformedPlatformEntry в предикате отбора —
    // иначе запись с площадкой-массивом дойдёт до цикла/адаптера.
    expect(isPlatformTerminal([])).toBe(false);
    expect(isMalformedPlatformEntry([])).toBe(true);
  });

  it('пустой объект {} — НЕ битый и НЕ terminal: остаётся eligible (статус неизвестен = ещё не пробовали)', () => {
    // Защитимое прочтение: нет статуса — значит платформу ещё не пробовали
    // публиковать, запись остаётся в разборе. Явно фиксируем, чтобы читатель
    // не счёл это недосмотром.
    expect(isMalformedPlatformEntry({})).toBe(false);
    expect(isPlatformTerminal({})).toBe(false);
  });

  it('bounded warn переиспользует shouldLogTerminalError: раз в час на content+platform', () => {
    const scheduler = getPublishScheduler();
    // @ts-ignore чистый стейт cooldown'а
    scheduler.terminalErrorLoggedAt = new Map();
    const marker = 'malformed_platform_entry';
    expect(scheduler.shouldLogTerminalError('c1', 'telegram', marker)).toBe(true);
    expect(scheduler.shouldLogTerminalError('c1', 'telegram', marker)).toBe(false); // повтор — молчит
    // другой content/platform — независимый ключ
    expect(scheduler.shouldLogTerminalError('c2', 'telegram', marker)).toBe(true);
  });
});

describe('AI-49: production-сторож — мутация «вернуть подстроку/рецидив» красит', () => {
  it('в планировщике есть предикат «нет retryable площадок → пропустить»', () => {
    expect(SRC).toMatch(/hasRetryablePlatform = platformNames\.some/);
    expect(SRC).toMatch(/!isPlatformTerminal\(platforms\[name\]\) && !isMalformedPlatformEntry\(platforms\[name\]\)/);
    expect(SRC).toMatch(/no retryable platforms \(all terminal\)/);
  });

  it('failed-площадка больше не печатает сохранённую ошибку по подстроке «not found»', () => {
    // Ветка failed не должна содержать прежний substring-лог.
    const failedIdx = SRC.indexOf('SKIP - status=failed');
    expect(failedIdx).toBeGreaterThan(-1);
    const failedBlock = SRC.slice(failedIdx, failedIdx + 400);
    expect(failedBlock).not.toContain("includes('not found')");
    expect(failedBlock).not.toContain('shouldLogTerminalError');
  });

  it('классификация больше не содержит голую подстроку «not found»', () => {
    const fn = SRC.slice(SRC.indexOf('export function classifyPublishFailure'), SRC.indexOf('export class PublishScheduler'));
    expect(fn).toContain("includes('chat not found')");
    expect(fn).not.toMatch(/includes\('not found'\)/);
  });

  it('v3: битая форма подсвечивается warn с машиночитаемым маркером, не содержимым', () => {
    expect(SRC).toMatch(/isMalformedPlatformEntry\(platformData\)/);
    expect(SRC).toMatch(/shouldLogTerminalError\(content\.id, platformName, 'malformed_platform_entry'\)/);
    expect(SRC).toMatch(/malformed_platform_entry/);
    // Производственный комментарий fail-close рядом с предикатом.
    const predIdx = SRC.indexOf('hasRetryablePlatform');
    const predWindow = SRC.slice(Math.max(0, predIdx - 900), predIdx);
    expect(predWindow).toContain('fail-close');
    expect(predWindow).toContain('не должна вызвать outbound');
  });
});
