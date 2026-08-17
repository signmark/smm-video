/**
 * AI-49: TikTok закрыт намеренно, а не по случайности.
 *
 * Положение дел на сегодня. В `server/routes/tiktok-auth.ts` есть полный набор
 * ручек: запуск авторизации, список аккаунтов, настройки, удаление, пробная
 * публикация и вебхук. Роутер при этом нигде не смонтирован — `server/index.ts`
 * импортирует его РОВНО ради одного: вытащить GET-коллбэк OAuth и повесить его
 * до общей проверки доступа. Всё остальное снаружи недостижимо.
 *
 * Почему это надо закрепить тестом. Недостижимость держится на отсутствии одной
 * строки `app.use`. Это не решение, а случайность: любой, кто захочет «починить
 * неработающий мастер TikTok», добавит эту строку — и вместе с полезными ручками
 * наружу выйдет вебхук, который не проверяет подпись отправителя, пишет тело
 * запроса в лог и возвращает его обратно. Тест превращает случайность в правило.
 *
 * Решение владельца от 17.08.2026: TikTok в текущем релизе не планируется, но и
 * строгого отказа нет — возможна будущая реализация через сторонние сервисы.
 * Поэтому код не удаляется, а фиксируется в закрытом состоянии.
 *
 * Если вы пришли сюда, потому что тест покраснел, — это не повод его поправить.
 * Это напоминание, что перед открытием ручек TikTok наружу нужны: проверка
 * подписи провайдера в самом обработчике, предел размера тела, ограничение
 * частоты и лог без сырого содержимого запроса.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  PUBLIC_API_PATHS,
  isPublicApiPath,
  createApiAuthGate,
} from '../middleware/api-auth-gate';
import tiktokAuthRouter from '../routes/tiktok-auth';

const ROOT = join(__dirname, '..', '..');
const indexSource = readFileSync(join(ROOT, 'server', 'index.ts'), 'utf-8');

describe('AI-49: вебхук TikTok не публичен', () => {
  it('POST на вебхук не считается публичным путём', () => {
    expect(isPublicApiPath('/api/tiktok/webhook', 'POST')).toBe(false);
  });

  it('GET на вебхук тоже не считается публичным', () => {
    // У GET-ветки вебхука тоже нет проверки подписи: она отвечает на challenge
    // всякому, кто его пришлёт.
    expect(isPublicApiPath('/api/tiktok/webhook', 'GET')).toBe(false);
  });

  it('в списке публичных путей нет ни одного правила про TikTok', () => {
    // Список публичного — единственное место, где такое перечисление живёт.
    // Правило, открывающее любой путь TikTok, обязано сначала обзавестись
    // проверкой подписи в обработчике (см. заголовок файла).
    const tiktokRules = PUBLIC_API_PATHS.filter(({ pattern }) =>
      pattern.test('/api/tiktok/webhook') ||
      pattern.test('/api/tiktok/accounts') ||
      pattern.test('/api/tiktok/test-publish'),
    );
    expect(tiktokRules).toEqual([]);
  });

  it('если роутер всё-таки смонтировать, общий гейт отобьёт вебхук без сессии', () => {
    // Проверка поведением: гейт закрывает вебхук сам по себе, и открыть его
    // можно только сознательным внесением в список публичного.
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiAuthGate((_req, res) => {
        res.status(401).json({ error: 'нужна сессия' });
      }),
    );
    app.use('/api', tiktokAuthRouter);

    return request(app)
      .post('/api/tiktok/webhook')
      .send({ event: 'что угодно' })
      .expect(401);
  });
});

describe('AI-49: снаружи открыт ровно один путь TikTok — коллбэк OAuth', () => {
  it('роутер TikTok нигде не смонтирован обычным app.use', () => {
    // Именно эта строка сделала бы недостижимые ручки достижимыми.
    expect(indexSource).not.toMatch(/app\.use\([^)]*tiktokAuthRouter/);
  });

  it('в обход проверки доступа вынесен только GET-коллбэк авторизации', () => {
    const tiktokBypassLines = indexSource
      .split('\n')
      .filter((line) => line.includes('tiktokAuthRouter') && line.includes('publicPath'));

    expect(tiktokBypassLines).toHaveLength(1);
    expect(tiktokBypassLines[0]).toContain("publicPath: '/api/tiktok/auth/callback'");
    expect(tiktokBypassLines[0]).toContain("method: 'get'");
    // POST-ветка того же адреса существует в роутере и наружу выходить не должна:
    // она ничего не проверяет и просто отвечает 200.
    expect(tiktokBypassLines[0]).not.toContain("method: 'post'");
  });
});
