/**
 * SM-36. Смысл проверок: правило доступа теперь одно, и оно обязано отвечать
 * одинаково на сервере и в интерфейсе. Отдельно стережём случай «пользователь
 * без почты» — при небрежном разборе списка он получал бы доступ даром.
 */
import { describe, it, expect } from 'vitest';
import {
  hasFeatureAccess,
  featureAccessFor,
  allowedFeatureEmails,
  parseFeatureEmails,
  PERSONAL_FEATURES,
  DEFAULT_FEATURE_EMAILS,
} from '../feature-access';

describe('кому доступна возможность', () => {
  it('владельцу — да, и это то же поведение, что было записано в странице', () => {
    expect(hasFeatureAccess({ email: 'signmark@gmail.com' }, 'styleAnalysis')).toBe(true);
  });

  it('постороннему — нет', () => {
    expect(hasFeatureAccess({ email: 'someone@example.com' }, 'styleAnalysis')).toBe(false);
  });

  it('регистр и пробелы в почте ничего не решают', () => {
    expect(hasFeatureAccess({ email: '  SignMark@Gmail.com ' }, 'styleAnalysis')).toBe(true);
  });

  it('пользователь без почты доступа не получает', () => {
    expect(hasFeatureAccess({ email: '' }, 'styleAnalysis')).toBe(false);
    expect(hasFeatureAccess({ email: null }, 'styleAnalysis')).toBe(false);
    expect(hasFeatureAccess(null, 'styleAnalysis')).toBe(false);
  });

  it('незнакомая возможность — отказ, а не молчаливое «да»', () => {
    expect(hasFeatureAccess({ email: 'signmark@gmail.com' }, 'somethingElse' as any)).toBe(false);
  });
});

describe('список адресов из настроек', () => {
  it('второй адрес владельца добавляется настройкой, без правки кода', () => {
    const env = { FEATURE_ACCESS_EMAILS: 'signmark@gmail.com, second@gmail.com' };
    expect(hasFeatureAccess({ email: 'second@gmail.com' }, 'styleAnalysis', env)).toBe(true);
    expect(hasFeatureAccess({ email: 'signmark@gmail.com' }, 'styleAnalysis', env)).toBe(true);
  });

  it('настройка заменяет список целиком, а не дополняет его', () => {
    const env = { FEATURE_ACCESS_EMAILS: 'only@example.com' };
    expect(hasFeatureAccess({ email: 'signmark@gmail.com' }, 'styleAnalysis', env)).toBe(false);
  });

  it('пустая настройка возвращает список по умолчанию', () => {
    expect(allowedFeatureEmails({ FEATURE_ACCESS_EMAILS: '   ' })).toEqual([...DEFAULT_FEATURE_EMAILS]);
    expect(allowedFeatureEmails({})).toEqual([...DEFAULT_FEATURE_EMAILS]);
  });

  it('мусор в списке не превращается в пустой адрес', () => {
    // Иначе пользователь без почты совпал бы с пустой строкой и прошёл.
    expect(parseFeatureEmails('a@b.ru,,  , c@d.ru')).toEqual(['a@b.ru', 'c@d.ru']);
    expect(hasFeatureAccess({ email: '' }, 'styleAnalysis', { FEATURE_ACCESS_EMAILS: 'a@b.ru,,' })).toBe(false);
  });
});

describe('ответ по всем возможностям сразу', () => {
  it('перечисляет каждую возможность', () => {
    const map = featureAccessFor({ email: 'signmark@gmail.com' });
    expect(Object.keys(map).sort()).toEqual([...PERSONAL_FEATURES].sort());
    expect(map.styleAnalysis).toBe(true);
    expect(map.platformAdaptation).toBe(true);
  });

  it('постороннему — всё закрыто, но перечислено', () => {
    const map = featureAccessFor({ email: 'nobody@example.com' });
    expect(Object.values(map).every((v) => v === false)).toBe(true);
    expect(Object.keys(map)).toHaveLength(PERSONAL_FEATURES.length);
  });
});
