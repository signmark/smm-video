import { describe, expect, it } from 'vitest';

import { resolveConnectionCheckToast } from '../connection-check-toast';

/**
 * SM-46: тост для «Проверить сейчас». При 0 настроенных площадок сервер отвечает
 * { success:false, message:'Нет настроенных площадок для проверки', results:{} } —
 * клиент обязан показать НЕЙТРАЛЬНОЕ сообщение сервера, а не ложное
 * «Связь есть со всеми настроенными площадками» (которое давали пустые results).
 * all-healthy / failure не изменяются.
 */
describe('SM-46: resolveConnectionCheckToast', () => {
  it('0 настроенных площадок (success:false) => нейтральный тост с сообщением сервера, не «связь есть»', () => {
    const t = resolveConnectionCheckToast({ success: false, message: 'Нет настроенных площадок для проверки', results: {} });
    expect(t.variant).toBe('default'); // не destructive
    expect(t.description).toBe('Нет настроенных площадок для проверки');
  });

  it('≥1 / все healthy (success:true, пустые failures) => прежний success-тост', () => {
    const t = resolveConnectionCheckToast({ success: true, results: { telegram: { ok: true }, vk: { ok: true } } });
    expect(t.variant).toBe('default');
    expect(t.description).toBe('Связь есть со всеми настроенными площадками');
  });

  it('одна failure => прежний destructive-тост с человеческим именем площадки', () => {
    const t = resolveConnectionCheckToast(
      { success: true, results: { telegram: { ok: true }, vk: { ok: false, reason: 'Бот выгнан' } } },
      (p) => (p === 'vk' ? 'ВКонтакте' : p),
    );
    expect(t.variant).toBe('destructive');
    expect(t.description).toBe('Нет связи: ВКонтакте');
  });
});
