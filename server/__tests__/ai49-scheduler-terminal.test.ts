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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPublishFailure } from '../services/publish-scheduler';
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
});

describe('AI-49: production-сторож — мутация «вернуть подстроку/рецидив» красит', () => {
  it('в планировщике есть предикат «нет retryable площадок → пропустить»', () => {
    expect(SRC).toMatch(/hasRetryablePlatform\s*=.*isPlatformTerminal/);
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
});
