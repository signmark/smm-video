/**
 * Заглушка «Адаптировать под площадки» (решение владельца 19.08).
 *
 * Смысл проверок: пока сохранение не сделано (SM-35), кнопка сохранения не должна
 * быть нажимаемой НИ ПРИ КАКОМ наборе выбранных площадок. Иначе человек пишет
 * текст под три площадки, жмёт «Сохранить» и узнаёт об отказе только после
 * работы — ровно то, из-за чего заглушку и делали.
 */
import { describe, it, expect } from 'vitest';
import {
  ADAPT_COMING_SOON_NOTICE,
  ADAPT_SAVING_AVAILABLE,
  adaptSaveState,
} from '../adapt-stub';

describe('заглушка адаптации под площадки', () => {
  it('кнопка выключена, даже когда площадки выбраны', () => {
    expect(adaptSaveState({ saving: false, anyPlatformEnabled: true })).toEqual({
      disabled: true,
      label: 'Скоро появится',
    });
  });

  it('кнопка выключена и когда не выбрано ничего', () => {
    expect(adaptSaveState({ saving: false, anyPlatformEnabled: false }).disabled).toBe(true);
  });

  it('подпись говорит «скоро», а не «сохранить» — обещать сохранение нельзя', () => {
    const state = adaptSaveState({ saving: false, anyPlatformEnabled: true });
    expect(state.label).not.toContain('Сохранить');
    expect(state.label).toContain('Скоро');
  });

  it('предупреждение объясняет и что можно, и чего нельзя', () => {
    // Человеку нужны оба факта: текст готовить можно, сохранить пока нельзя.
    expect(ADAPT_COMING_SOON_NOTICE).toContain('скоро появится');
    expect(ADAPT_COMING_SOON_NOTICE).toContain('сохранить пока нельзя');
    // Внутренних имён в тексте для человека быть не должно.
    expect(ADAPT_COMING_SOON_NOTICE).not.toContain('n8n');
    expect(ADAPT_COMING_SOON_NOTICE).not.toContain('N8N');
  });

  it('когда сохранение включат, кнопка снова живёт по выбранным площадкам', () => {
    // Проверка самой развилки: заглушка снимается одним флагом, и поведение
    // возвращается к обычному, а не остаётся выключенным навсегда.
    if (ADAPT_SAVING_AVAILABLE) {
      expect(adaptSaveState({ saving: false, anyPlatformEnabled: true }).disabled).toBe(false);
      expect(adaptSaveState({ saving: false, anyPlatformEnabled: false }).disabled).toBe(true);
      expect(adaptSaveState({ saving: true, anyPlatformEnabled: true }).label).toBe('Сохранение...');
    } else {
      expect(ADAPT_SAVING_AVAILABLE).toBe(false);
    }
  });
});
