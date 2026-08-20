/**
 * SM-42. Подсказка у второй цифры обязана называть числа так, как они стоят на
 * экране. Владелец 20.08: «нет 1го и 2го чисел, только цифры и цифры в
 * скобках» — то есть «Первое число… Второе…» описывало страницу, которой нет.
 *
 * Проверяем сами файлы локалей, а не компонент: в тестах компонента словарь
 * подменён, и подмена не заметит, если в настоящем переводе вернётся счёт по
 * порядку.
 */
import { describe, it, expect } from 'vitest';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

const LOCALES = [
  { lang: 'ru', dict: ru as any, ordinals: [/Перв(ое|ый|ая)\s+числ/i, /Втор(ое|ой|ая)\s+числ/i], anchor: 'в скобках' },
  { lang: 'en', dict: en as any, ordinals: [/the\s+first\s+number/i, /the\s+second\s+number/i], anchor: 'bracketed' },
  { lang: 'es', dict: es as any, ordinals: [/el\s+primer\s+número/i, /el\s+segundo\s+número/i], anchor: 'entre paréntesis' },
];

describe('SM-42: подсказка про число по каналу', () => {
  for (const { lang, dict, ordinals, anchor } of LOCALES) {
    describe(lang, () => {
      const hint: string = dict.analytics.channelHint;
      const intro: string = dict.analytics.channelBreakdownIntro;
      const value: string = dict.analytics.channelValue;

      it('не считает числа по порядку — на экране их порядок не назван', () => {
        for (const ordinal of ordinals) {
          expect(hint).not.toMatch(ordinal);
        }
      });

      it('называет число там, где человек его видит — в скобках', () => {
        expect(hint.toLowerCase()).toContain(anchor);
      });

      it('разбор по кампаниям объясняет то же самое число', () => {
        expect(intro.toLowerCase()).toContain(anchor);
      });

      it('сама вторая цифра подписана, а не стоит голой', () => {
        // '{{value}}' в одиночку означало бы «(189)» без единого слова.
        expect(value.replace('{{value}}', '').trim().length).toBeGreaterThan(0);
      });
    });
  }
});
