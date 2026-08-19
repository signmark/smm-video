/**
 * SM-24 (продолжение): метка Telegram отвечает на вопрос «дойдёт ли публикация».
 *
 * ЧТО БЫЛО. Метка «Настроено» загоралась от сохранённых полей. Отозванный
 * токен, выгнанный из канала бот и бот без права публикации выглядели точно
 * так же, как исправное подключение, — правду человек узнавал из неудачной
 * публикации. Тестировщик ждал именно живую проверку связи.
 */
import { describe, it, expect } from 'vitest';
import { telegramBadgeState, TELEGRAM_BADGE_CLASSES } from '../telegram-connection-state';

describe('SM-24: метка состояния Telegram', () => {
  it('проверки ещё не было — говорим только про сохранённые настройки', () => {
    expect(telegramBadgeState({})).toEqual({ label: 'Настроено', tone: 'ok' });
    expect(telegramBadgeState(undefined)).toEqual({ label: 'Настроено', tone: 'ok' });
  });

  it('проверка идёт — так и написано', () => {
    expect(telegramBadgeState({ isLoading: true }).label).toBe('Проверяем связь');
  });

  it('связь подтверждена — «Связь есть», а не «Настроено»', () => {
    expect(telegramBadgeState({ isValid: true })).toEqual({ label: 'Связь есть', tone: 'ok' });
  });

  it('отказ по настройке — красная «Нет связи»', () => {
    expect(telegramBadgeState({ isValid: false, severity: 'error' })).toEqual({
      label: 'Нет связи',
      tone: 'fail',
    });
  });

  it('временный сбой не выдаётся за сломанное подключение', () => {
    // Сеть, таймаут и молчание Telegram ничего не говорят о настройках:
    // требовать от человека действий не за что.
    expect(telegramBadgeState({ isValid: false, severity: 'warning' })).toEqual({
      label: 'Связь не проверена',
      tone: 'unknown',
    });
  });

  it('состояние загрузки важнее прежнего вердикта', () => {
    // Иначе при перепроверке мёртвого подключения метка ещё секунду держит
    // старое «Нет связи», хотя ответа уже нет ни за, ни против.
    expect(telegramBadgeState({ isLoading: true, isValid: false, severity: 'error' }).label)
      .toBe('Проверяем связь');
  });

  it('у каждого состояния свой цвет — состояния различимы глазом', () => {
    const tones = ['ok', 'pending', 'unknown', 'fail'] as const;
    const classes = tones.map(t => TELEGRAM_BADGE_CLASSES[t]);
    expect(new Set(classes).size).toBe(tones.length);
    classes.forEach(c => expect(c).toBeTruthy());
  });
});
