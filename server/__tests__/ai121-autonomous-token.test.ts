/**
 * AI-121: истёкший токен не должен превращаться в молча испорченный контент.
 *
 * ЧТО БЫЛО. Автономный цикл работает часами, пользовательский JWT живёт минуты.
 * Когда токен истекал и обновить его не удавалось, «откат» возвращал ровно тот
 * же истёкший токен (`process.env.DIRECTUS_STATIC_TOKEN || state.authToken`).
 * В строке была точка, значит она считалась живым JWT и уходила в Directus как
 * Bearer. Каждый запрос получал 403, каждый catch его глотал — и цикл ПРОДОЛЖАЛ
 * работу: настройки кампании не прочитаны, ключевых слов ноль, промт картинки не
 * сохранён. Снаружи всё выглядело здоровым, а пользователь получал посты мимо
 * своей темы и своих настроек.
 *
 * ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ. Первая часть — поведение чистой функции, которая теперь
 * принимает решение: живость токена определяется по сроку, а не по наличию точки
 * в строке. Вторая часть — сканер исходника (правило 49): он не доказывает
 * поведение цикла, а стережёт ровно те три места, где отказ раньше глотался, и
 * ту строку отката, из-за которой всё и началось.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyAuthToken } from '../services/autonomous-ai';

function src(): string {
  return readFileSync(join(__dirname, '../services/autonomous-ai.ts'), 'utf-8');
}

/** JWT с заданным exp. Подпись не проверяется — важен только payload. */
function jwt(expSec: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url');
  return `header.${payload}.signature`;
}

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);
const nowSec = Math.floor(NOW / 1000);

describe('AI-121: живость токена определяется по сроку, а не по виду строки', () => {
  it('живой JWT остаётся пользовательским токеном', () => {
    expect(classifyAuthToken(jwt(nowSec + 3600), NOW)).toBe('live_jwt');
  });

  it('истёкший JWT распознаётся именно как истёкший, а не как живой', () => {
    // Ровно этот случай ломал прод: точка в строке есть, значит «JWT», значит
    // отправляем как Bearer — и получаем 403 на каждый запрос цикла.
    expect(classifyAuthToken(jwt(nowSec - 1), NOW)).toBe('expired_jwt');
    expect(classifyAuthToken(jwt(nowSec - 86400), NOW)).toBe('expired_jwt');
  });

  it('граница срока не считается живым токеном', () => {
    expect(classifyAuthToken(jwt(nowSec), NOW)).toBe('expired_jwt');
  });

  it('непрозрачный служебный токен — отдельный род, не «сломанный JWT»', () => {
    // Служебный токен Directus точек не содержит; его нельзя слать как Bearer,
    // но и мёртвым он не является — по нему идут админские операции.
    expect(classifyAuthToken('a'.repeat(64), NOW)).toBe('opaque');
  });

  it('пустой токен — это отсутствие доступа, а не пустой JWT', () => {
    expect(classifyAuthToken('', NOW)).toBe('none');
    expect(classifyAuthToken(undefined, NOW)).toBe('none');
  });

  it('неразбираемый JWT считается мёртвым, а не живым', () => {
    // Осторожность намеренная: сходить в Directus с сомнительным токеном дороже,
    // чем отказаться от него. Ошибка в эту сторону стоит одного пропущенного
    // цикла, ошибка в другую — испорченных постов у живых людей.
    expect(classifyAuthToken('a.b.c', NOW)).toBe('expired_jwt');
    expect(classifyAuthToken('....', NOW)).toBe('expired_jwt');
  });

  it('JWT без поля exp живым не считается', () => {
    const noExp = `header.${Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url')}.sig`;
    expect(classifyAuthToken(noExp, NOW)).toBe('expired_jwt');
  });
});

describe('AI-121: сканер исходника — три места, где отказ раньше глотался', () => {
  it('откат больше не возвращает тот самый истёкший токен', () => {
    const s = src();
    const fnIdx = s.indexOf('async function ensureFreshUserToken(state: AutonomousState)');
    expect(fnIdx).toBeGreaterThan(0);
    const body = s.slice(fnIdx, s.indexOf('\n}', fnIdx));

    // Именно это выражение и было дефектом: если статического токена нет,
    // «откат» подставлял мёртвый пользовательский токен.
    expect(body).not.toContain('process.env.DIRECTUS_STATIC_TOKEN || state.authToken');
    expect(body).toContain("const adminFallback = process.env.DIRECTUS_STATIC_TOKEN || ''");
    expect(body).toContain("logEvent(\n    'autonomous.token_refresh_failed'");
  });

  it('цикл не стартует с мёртвым токеном', () => {
    const s = src();
    const fnIdx = s.indexOf('async function runAutonomousCycle(state: AutonomousState)');
    expect(fnIdx).toBeGreaterThan(0);
    const head = s.slice(fnIdx, s.indexOf('ФАЗА 1', fnIdx));

    const checkIdx = head.indexOf('const tokenKind = classifyAuthToken(activeToken)');
    expect(checkIdx).toBeGreaterThan(0);

    // Проверка стоит ДО первого чтения данных кампании — иначе цикл успеет
    // сходить в Directus мёртвым токеном и получить свой первый 403.
    const firstReadIdx = head.indexOf("directusCrud.getById('user_campaigns'");
    expect(firstReadIdx).toBeGreaterThan(checkIdx);

    expect(head).toContain("reason: 'token_refresh_failed'");
  });

  it('нечитаемые настройки и ключевые слова прерывают цикл, а не подставляют умолчания', () => {
    const s = src();
    const fnIdx = s.indexOf('async function runAutonomousCycle(state: AutonomousState)');
    const body = s.slice(fnIdx);

    for (const reason of ['campaign_settings_unreadable', 'campaign_keywords_unreadable']) {
      const idx = body.indexOf(`reason: '${reason}'`);
      expect(idx).toBeGreaterThan(0);

      // От события до конца обработчика цикл обязан прекратиться. Если снова
      // оставить только предупреждение, пост уйдёт на умолчаниях — ровно то,
      // из-за чего задача и заведена.
      const tail = body.slice(idx, idx + 900);
      expect(tail).toContain('state.cycleRunning = false;');
      expect(tail).toContain('return;');
    }
  });

  it('каждое прерывание проставляет время цикла — иначе цикл каждые пять секунд', () => {
    // Найдено на живом проде уже ПОСЛЕ выкатки прерываний. Следующая попытка
    // планируется от времени последнего цикла, а прерывание его не проставляло:
    // планировщик считал, что цикла ещё не было, выдерживал минимальную задержку
    // в пять секунд и запускал снова. За семь минут 95 прерываний вместо одного.
    const s = src();
    const fnIdx = s.indexOf('async function runAutonomousCycle(state: AutonomousState)');
    const body = s.slice(fnIdx);

    for (const reason of ['token_refresh_failed', 'campaign_settings_unreadable', 'campaign_keywords_unreadable']) {
      const idx = body.indexOf("reason: '" + reason + "'");
      expect(idx).toBeGreaterThan(0);
      const tail = body.slice(idx, idx + 900);
      expect(tail).toContain('state.lastCycleAt = new Date();');
      // Время обязано проставиться ДО выхода, иначе в нём нет смысла.
      expect(tail.indexOf('state.lastCycleAt = new Date();')).toBeLessThan(tail.indexOf('return;'));
    }
  });

  it('несохранённый промт картинки виден в журнале и НЕ роняет цикл', () => {
    const s = src();
    const idx = s.indexOf("'autonomous.image_prompt_unsaved'");
    expect(idx).toBeGreaterThan(0);

    // Сам пост от этого не страдает, поэтому прерывать цикл здесь было бы
    // вредно: мы потеряли бы годный контент из-за косметики.
    const tail = s.slice(idx, idx + 500);
    expect(tail).not.toContain('state.cycleRunning = false;');
  });

  it('способ авторизации при сохранении промта выбирается общей функцией', () => {
    const s = src();
    // Раньше здесь стояло `authToken ? { authToken } : { useAdminToken: true }`:
    // непрозрачный служебный токен уходил как Bearer и отвергался.
    // Якорь — именно сохранение промта (поле prompt), а не соседние записи в
    // ту же коллекцию: их несколько, и по общему началу вызова легко попасть
    // не в то место.
    const idx = s.indexOf('prompt: imagePrompt');
    expect(idx).toBeGreaterThan(0);
    const call = s.slice(idx, idx + 200);
    expect(call).toContain('directusAuth(authToken)');
    expect(call).not.toContain('authToken ? { authToken } : { useAdminToken: true }');
  });
});
