import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SM-46 (client wiring): реальный onSuccess кнопки «Проверить сейчас» в
 * `campaigns/[id].tsx` обязан вызывать resolveConnectionCheckToast и класть его
 * результат в toast. Раньше onSuccess строил «Связь есть со всеми настроенными
 * площадками» сам из пустых results; после фикса показ переезжает в чистую функцию.
 * Source-boundary guard: удаление/обход вызова helper краснит.
 */
const page = () => readFileSync(join(__dirname, '../../pages/campaigns/[id].tsx'), 'utf-8');

describe('SM-46: campaigns/[id].tsx onSuccess вызывает resolveConnectionCheckToast', () => {
  it('useMutation «Проверить сейчас» (social/check) использует helper и его результат идёт в toast', () => {
    const s = page();

    // Точка-источник: onSuccess кнопки социальной проверки вызывает resolveConnectionCheckToast.
    expect(s).toContain('resolveConnectionCheckToast(data, platformTitle)');

    // Результат helper (variant/description) попадает в toast — не строится вручную.
    const callIdx = s.indexOf('resolveConnectionCheckToast(data, platformTitle)');
    expect(callIdx).toBeGreaterThan(0);
    const windowAfter = s.slice(callIdx, callIdx + 400);
    expect(windowAfter).toContain('toast({ variant: t.variant, description: t.description })');

    // Адресат социальной проверки — именно тот маршрут, что чинит SM-46.
    expect(s).toContain('`/api/campaigns/${id}/social/check`');
  });

  it('удаление вызова helper (мутация) краснит: onSuccess не должен сам строить «Связь есть»', () => {
    const s = page();
    const check = s.slice(
      s.indexOf('Проверить сейчас'),
      s.indexOf('onError:', s.indexOf('checkConnections')),
    );
    // в блоке социальной проверки нет ручного построения «Связь есть...» из results —
    // иначе удаление helper осталось бы зелёным.
    const blockStart = s.indexOf('`/api/campaigns/${id}/social/check`');
    const blockEnd = s.indexOf('updateCampaign', blockStart);
    const socialBlock = s.slice(blockStart, blockEnd);
    expect(socialBlock).toContain('resolveConnectionCheckToast');
    expect(socialBlock).not.toContain("'Связь есть со всеми настроенными площадками'");
  });
});
