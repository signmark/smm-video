/**
 * Публичный origin выбирается безопасно и переживёт переезд домена.
 *
 * Контекст 29.07.2026. Рабочий домен нового прода — `smm.nplanner.ru`. У
 * `omemo.tech` DNS пока смотрит на старый сервер, и когда его переключат,
 * приложение не должно требовать правок кода: новый домен обязан быть заранее
 * ДОПУСТИМЫМ, но не считаться уже работающим.
 *
 * Отсюда два разных понятия, которые легко перепутать:
 *
 *   primary/canonical (`APP_PUBLIC_URL`) — адрес, который мы САМИ подставляем в
 *     письма, OAuth redirect_uri, return_url платежей и ссылки на медиа;
 *   allowlist (`+ APP_EXTRA_ORIGINS`)     — адреса, на которых нас допустимо
 *     ОТКРЫТЬ и чей Host можно принять.
 *
 * Находка ревью 2026-07-29: часть кода собирала origin прямо из заголовка Host
 * (`vk-oauth.ts`, `stories.ts`, OAuth-роуты Threads/Instagram). Host полностью
 * подконтролен клиенту, а уходил он в redirect_uri и в ссылки на медиа —
 * то есть чужой домен подставлялся в OAuth-поток и в письма.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPublicOrigin,
  getOwnOrigins,
  getAllowedOrigins,
  resolveRequestOrigin,
} from '../utils/public-url';
import { getAppBaseUrl } from '../utils/app-base-url';

const PRIMARY = 'https://smm.nplanner.ru';
const FUTURE = 'https://smm.omemo.tech';

const SAVED = { ...process.env };

beforeEach(() => {
  process.env.APP_PUBLIC_URL = PRIMARY;
  process.env.APP_EXTRA_ORIGINS = FUTURE;
  delete process.env.REPLIT_DEV_DOMAIN;
  delete process.env.API_BASE_URL;
  delete process.env.PUBLIC_URL;
  delete process.env.APP_URL;
  delete process.env.SMM_DOMAIN;
});

afterEach(() => {
  process.env = { ...SAVED };
});

/** Мини-заглушка Express-запроса: нам нужен только Host. */
const reqWithHost = (host: string) => ({
  get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined),
  headers: { host },
  protocol: 'https',
}) as any;

describe('primary и allowlist — разные вещи', () => {
  it('канонический origin сейчас — smm.nplanner.ru', () => {
    expect(getPublicOrigin()).toBe(PRIMARY);
  });

  it('будущий omemo.tech допустим, но каноническим НЕ становится', () => {
    expect(getOwnOrigins()).toContain(FUTURE);
    expect(getPublicOrigin()).toBe(PRIMARY);
  });

  it('CORS-белый список включает свои домены и партнёров', () => {
    const allowed = getAllowedOrigins();
    expect(allowed).toContain(PRIMARY);
    expect(allowed).toContain(FUTURE);
  });
});

describe('Host не является источником правды', () => {
  it('подделанный Host не подставляется в origin', () => {
    expect(resolveRequestOrigin(reqWithHost('evil.example.com'))).toBe(PRIMARY);
  });

  it('Host из белого списка принимается', () => {
    expect(resolveRequestOrigin(reqWithHost('smm.omemo.tech'))).toBe(FUTURE);
  });

  it('пустой Host не роняет и даёт канонический origin', () => {
    expect(resolveRequestOrigin(reqWithHost(''))).toBe(PRIMARY);
  });

  it('домен, лишь СОДЕРЖАЩИЙ разрешённый как подстроку, не проходит', () => {
    // Классический обход проверки через includes(): «наш домен внутри чужого».
    expect(resolveRequestOrigin(reqWithHost('smm.nplanner.ru.evil.com'))).toBe(PRIMARY);
    expect(resolveRequestOrigin(reqWithHost('evilsmm.nplanner.ru'))).toBe(PRIMARY);
  });

  it('replit.dev как подстрока чужого домена больше не проходит', () => {
    // Была ветка `host.includes('replit.dev')` — её удовлетворял и
    // `replit.dev.attacker.com`, и `notreplit.dev-evil.com`.
    expect(getAppBaseUrl(reqWithHost('replit.dev.attacker.com'))).toBe(PRIMARY);
    expect(getAppBaseUrl(reqWithHost('evil-replit.dev'))).toBe(PRIMARY);
  });
});

describe('ссылки в письмах', () => {
  it('строятся по каноническому origin при чужом Host', () => {
    expect(getAppBaseUrl(reqWithHost('evil.example.com'))).toBe(PRIMARY);
  });

  it('на разрешённом домене остаются на нём', () => {
    expect(getAppBaseUrl(reqWithHost('smm.omemo.tech'))).toBe(FUTURE);
  });
});

describe('готовность к переключению DNS omemo.tech', () => {
  it('смена APP_PUBLIC_URL на omemo.tech не требует правок кода', () => {
    // Сценарий cutover: домен переезжает, прежний остаётся допустимым.
    process.env.APP_PUBLIC_URL = 'https://omemo.tech';
    process.env.APP_EXTRA_ORIGINS = `${PRIMARY},${FUTURE}`;

    expect(getPublicOrigin()).toBe('https://omemo.tech');
    expect(getOwnOrigins()).toContain(PRIMARY);
    expect(resolveRequestOrigin(reqWithHost('smm.nplanner.ru'))).toBe(PRIMARY);
    expect(resolveRequestOrigin(reqWithHost('omemo.tech'))).toBe('https://omemo.tech');
  });

  it('голый хост без схемы в APP_PUBLIC_URL нормализуется', () => {
    process.env.APP_PUBLIC_URL = 'omemo.tech';
    expect(getPublicOrigin()).toBe('https://omemo.tech');
  });
});

describe('REPLIT_DEV_DOMAIN не перебивает явно заданный домен', () => {
  it('APP_PUBLIC_URL имеет приоритет', () => {
    // В нескольких местах кода стояла обратная очередь: REPLIT сначала, и на
    // проде с выставленным REPLIT_DEV_DOMAIN ссылки уехали бы в превью-окружение.
    process.env.REPLIT_DEV_DOMAIN = 'preview.replit.dev';
    expect(getPublicOrigin()).toBe(PRIMARY);
  });

  it('без APP_PUBLIC_URL превью-домен используется', () => {
    delete process.env.APP_PUBLIC_URL;
    process.env.REPLIT_DEV_DOMAIN = 'preview.replit.dev';
    expect(getPublicOrigin()).toBe('https://preview.replit.dev');
  });
});
