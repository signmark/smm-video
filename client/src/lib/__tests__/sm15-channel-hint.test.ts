import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SM-15: подпись у второй цифры (метрики по всему каналу) не должна объяснять
 * расхождение ручными публикациями «мимо системы».
 *
 * ПОЧЕМУ ЭТО НЕ ПРИДИРКА К СЛОВАМ. Замер по боевой базе 19.08: расхождение
 * дают три источника, и ручные публикации среди них последний. Шесть каналов
 * ведут по две-три кампании сразу, а 67 опубликованных записей из 2862 не
 * сохранили идентификатор поста и потому не сопоставляются с каналом никогда.
 * Прежняя подпись превращала наш собственный дефект атрибуции в обвинение
 * пользователя — по этому поводу тестировщик и завёл SM-15.
 *
 * Тест сторожит не формулировку, а ОБЕЩАНИЕ: перечислены все три источника и
 * нет утверждения «мимо системы».
 */

const read = (relative: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));

const hint = (locale: string): string => read(`../../locales/${locale}.json`).analytics.channelHint;

describe('SM-15: подпись у канальной цифры', () => {
  it('не объявляет расхождение ручными публикациями мимо системы', () => {
    expect(hint('ru')).not.toMatch(/мимо системы/i);
    expect(hint('en')).not.toMatch(/outside the system/i);
    expect(hint('es')).not.toMatch(/fuera del sistema/i);
  });

  it('называет все три источника расхождения, а не один', () => {
    const ru = hint('ru');
    expect(ru).toMatch(/других кампаний/i);
    expect(ru).toMatch(/идентификатор/i);
    expect(ru).toMatch(/вручную/i);
  });

  it('сохраняет подпись во всех трёх локалях', () => {
    for (const locale of ['ru', 'en', 'es']) {
      expect(hint(locale).length).toBeGreaterThan(40);
    }
  });
});
