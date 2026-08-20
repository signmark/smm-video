/**
 * SM-35, сторона интерфейса. Здесь сторожатся две вещи, каждая из которых уже
 * стоила человеку написанного текста.
 *
 * Первое: кнопка «Сохранить» должна работать. До SM-35 на её месте стояла
 * заглушка «Скоро появится», выключенная при любом наборе площадок.
 *
 * Второе: окно адаптации обязано открываться с уже сохранёнными текстами.
 * Иначе человек открывает его во второй раз, видит заново придуманную
 * адаптацию вместо своей правки и, сохранив, затирает собственную работу.
 */
import { describe, it, expect } from 'vitest';
import { adaptSaveState, savedPlatformTexts } from '../adapt-save';

describe('кнопка сохранения', () => {
  it('доступна, когда выбрана хотя бы одна площадка', () => {
    expect(adaptSaveState({ saving: false, anyPlatformEnabled: true }))
      .toEqual({ disabled: false, label: 'Сохранить' });
  });

  it('выключена, пока не выбрано ни одной площадки', () => {
    expect(adaptSaveState({ saving: false, anyPlatformEnabled: false }))
      .toEqual({ disabled: true, label: 'Сохранить' });
  });

  it('во время сохранения выключена и говорит об этом', () => {
    expect(adaptSaveState({ saving: true, anyPlatformEnabled: true }))
      .toEqual({ disabled: true, label: 'Сохранение...' });
  });

  it('заглушки «Скоро появится» больше нет ни при каком наборе', () => {
    const labels = [
      adaptSaveState({ saving: false, anyPlatformEnabled: false }).label,
      adaptSaveState({ saving: false, anyPlatformEnabled: true }).label,
      adaptSaveState({ saving: true, anyPlatformEnabled: true }).label,
    ];
    expect(labels).not.toContain('Скоро появится');
  });
});

describe('сохранённые тексты по площадкам', () => {
  it('берутся подписи всех заполненных площадок', () => {
    const texts = savedPlatformTexts({
      telegram: { caption: 'текст для телеграма', status: 'published' },
      vk: { caption: 'текст для ВК', status: 'pending' },
    });

    expect(texts).toEqual({ telegram: 'текст для телеграма', vk: 'текст для ВК' });
  });

  it('пустая подпись — это «не заполнено», а не текст', () => {
    // Иначе окно откроется с пустой вкладкой вместо свежей адаптации.
    expect(savedPlatformTexts({ telegram: { caption: '   ' } })).toEqual({});
  });

  it('запись без площадок не роняет окно', () => {
    expect(savedPlatformTexts(null)).toEqual({});
    expect(savedPlatformTexts(undefined)).toEqual({});
    expect(savedPlatformTexts('строка' as any)).toEqual({});
  });

  it('мусор вместо площадки пропускается', () => {
    expect(savedPlatformTexts({ vk: null, telegram: 'строка', facebook: { caption: 'ок' } } as any))
      .toEqual({ facebook: 'ок' });
  });

  it('поля публикации сюда не попадают — окно правит только текст', () => {
    const texts = savedPlatformTexts({
      telegram: { caption: 'текст', postId: '123', postUrl: 'https://t.me/c/123' },
    });

    expect(texts).toEqual({ telegram: 'текст' });
  });
});
