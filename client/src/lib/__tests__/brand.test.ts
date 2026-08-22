/**
 * Тест на константы бренда (AI-89).
 *
 * ЗАЧЕМ. Захардкоженные адреса в JSX (`AutonomousSettings.tsx`,
 * `SupportChat.tsx`, `register.tsx`) ушли в `client/src/lib/brand.ts`.
 * Этот тест:
 *   - подтверждает, что дефолтные значения те же, что были захардкожены
 *     раньше (поведение нашей установки не меняется);
 *   - подтверждает структуру BRAND и LEGAL_PATHS, чтобы случайно
 *     не убрать нужное поле при будущих правках.
 *
 * Мутация: убрать одно поле BRAND — тест краснеет (структурный sanity).
 */
import { describe, it, expect } from 'vitest';
import { BRAND, LEGAL_PATHS } from '../brand';

describe('AI-89 / brand-константы клиента', () => {
  it('BRAND.appUrl — публичный адрес установки (по умолчанию omemo)', () => {
    expect(BRAND.appUrl).toBe('https://smm.omemo.tech');
  });

  it('BRAND.productUrl — адрес продукта в подписи', () => {
    expect(BRAND.productUrl).toBe('https://omemo.tech');
  });

  it('BRAND.supportEmail — адрес поддержки', () => {
    expect(BRAND.supportEmail).toBe('support@omemo.tech');
  });

  it('BRAND.supportTelegramHandle — handle Telegram-канала поддержки', () => {
    expect(BRAND.supportTelegramHandle).toBe('omemo_support');
  });

  it('LEGAL_PATHS.terms — путь к оферте', () => {
    expect(LEGAL_PATHS.terms).toBe('/smmniap_static/terms.html');
  });

  it('LEGAL_PATHS.privacy — путь к политике', () => {
    expect(LEGAL_PATHS.privacy).toBe('/smmniap_static/privacy.html');
  });

  it('BRAND — frozen по структуре (sanity против случайной правки)', () => {
    expect(Object.keys(BRAND).sort()).toEqual(
      ['appUrl', 'productUrl', 'supportEmail', 'supportTelegramHandle'].sort(),
    );
  });

  it('LEGAL_PATHS — frozen по структуре (sanity)', () => {
    expect(Object.keys(LEGAL_PATHS).sort()).toEqual(['privacy', 'terms'].sort());
  });
});
