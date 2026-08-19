/**
 * SM-38. Смысл проверок: кампания без темы не должна получать посты «ни о чём»,
 * а отказ чтения ключевых слов должен быть отличим от честного нуля.
 *
 * Отдельно закреплён случай, который делал защиту мёртвой: инструмент чтения
 * ключевых слов возвращает ошибку ЗНАЧЕНИЕМ, а не бросает её.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolErrorText, hasUsableTopic } from '../services/autonomous-topic-guard';

describe('отказ инструмента, возвращённый значением', () => {
  it('ошибка в ответе видна, хотя исключения не было', () => {
    // Ровно то, что возвращает getCampaignKeywords при 401.
    const res = { error: 'Ошибка получения ключевых слов: Error: Request failed with status code 401' };
    expect(toolErrorText(res)).toContain('401');
  });

  it('честный ноль ключевых слов отказом не считается', () => {
    expect(toolErrorText({ keywords: [], count: 0 })).toBe('');
  });

  it('ошибка объектом без текста всё равно не теряется', () => {
    expect(toolErrorText({ error: { code: 500 } })).toBe('инструмент вернул ошибку без текста');
  });

  it('ответа нет — отказа тоже нет', () => {
    expect(toolErrorText(null)).toBe('');
    expect(toolErrorText(undefined)).toBe('');
  });
});

describe('есть ли теме откуда взяться', () => {
  it('ключевые слова — тема есть', () => {
    expect(hasUsableTopic({ keywords: ['молитва'], campaignName: 'Отче наш' })).toBe(true);
  });

  it('пустые и пробельные слова темой не считаются', () => {
    expect(hasUsableTopic({ keywords: ['', '   '], campaignName: 'Отче наш' })).toBe(false);
  });

  it('живой случай 17.08: слов нет, описание повторяет название — темы нет', () => {
    expect(hasUsableTopic({
      keywords: [],
      campaignName: 'Отче наш',
      campaignDescription: 'Кампания Отче наш',
    })).toBe(false);
  });

  it('содержательное описание — тема есть', () => {
    expect(hasUsableTopic({
      keywords: [],
      campaignName: 'Отче наш',
      campaignDescription: 'Ежедневные разборы молитв и православных праздников',
    })).toBe(true);
  });

  it('команда запуска задаёт тему сама по себе', () => {
    expect(hasUsableTopic({
      keywords: [],
      campaignName: 'Отче наш',
      launchCommand: 'пиши про утренние молитвы и посты церковного календаря',
    })).toBe(true);
  });

  it('совсем пустая кампания — темы нет', () => {
    expect(hasUsableTopic({})).toBe(false);
  });
});

/**
 * Правило 49: ниже сканер исходника. Он стережёт места подключения защиты в
 * цикле — сам цикл целиком тут не проигрывается. Поведение защиты доказано
 * случаями выше.
 */
describe('защита подключена в самом цикле', () => {
  const src = () => readFileSync(join(__dirname, '../services/autonomous-ai.ts'), 'utf-8');

  it('отказ чтения ключевых слов поднимается из ответа в исключение', () => {
    const s = src();
    expect(s).toContain('const kwErrText = toolErrorText(kwRes);');
    // Именно до разбора списка: иначе отказ снова превратится в пустой список.
    expect(s.indexOf('const kwErrText = toolErrorText(kwRes);'))
      .toBeLessThan(s.indexOf('const kws = Array.isArray(kwRes?.keywords)'));
  });

  it('проверка темы стоит до генерации и прерывает цикл', () => {
    const s = src();
    expect(s).toContain('hasUsableTopic({');
    expect(s).toContain("noteAbortedCycle(state, 'campaign_topic_missing');");
    expect(s.indexOf('hasUsableTopic({')).toBeLessThan(s.indexOf('ФАЗА 1: Ранжирование трендов'));
  });

  it('человеку сказано, что заполнить, а не «войдите заново»', () => {
    const s = src();
    const stop = s.slice(s.indexOf('function stopMessageForAbortReason'), s.indexOf('function warningMessageForAbortReason'));
    expect(stop).toContain('campaign_topic_missing');
    expect(stop).toContain('Добавьте ключевые слова');
    const warn = s.slice(s.indexOf('function warningMessageForAbortReason'));
    expect(warn.slice(0, 900)).toContain('campaign_topic_missing');
  });
});
