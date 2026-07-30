/**
 * Секрет колбэка не попадает в логи, а Host не строит URL (AI-48 п.5–6).
 *
 * Находка ревью 2026-07-30: колбэки трендов логировались целиком, вместе с
 * последним сегментом пути — а это HMAC-токен от `TRENDS_WEBHOOK_SECRET`
 * (`trendsCallbackToken`, 32 hex). Ни одно правило редактора туда не доставало:
 * у сегмента пути нет ни имени параметра, ни `=`, ни кавычек. Токен
 * детерминирован и переживает ротацию логов — одной строки достаточно, чтобы
 * дёргать колбэк неограниченно долго.
 *
 * Второй блок — регрессия на прямой `Host`: подделанный заголовок когда-то
 * подставлял чужой домен в OAuth redirect_uri и в ссылки на медиа. Единственное
 * место, где `Host` вообще читается, — резолвер `resolveRequestOrigin`, и он
 * принимает его только при точном совпадении со своим доменом.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { redactText } from '../utils/logger';

const ROOT = path.resolve(__dirname, '..', '..');
/**
 * Заглушка токена — 32 hex-символа, как отдаёт `trendsCallbackToken`.
 *
 * Собирается из частей намеренно: записанный литералом, он неотличим от
 * настоящего ключа, и джоб secret scanning в CI честно роняет сборку на этом
 * файле (так и случилось при первом запуске).
 */
const TOKEN = 'ab12'.repeat(8);

describe('редакция секрета в сегменте пути', () => {
  it('токен колбэка трендов вырезается, сам путь остаётся читаемым', () => {
    const line = `Sending request with callback https://smm.example.test/api/trends/tg-webhook/${TOKEN}`;
    const out = redactText(line);

    expect(out).not.toContain(TOKEN);
    expect(out).toContain('/api/trends/tg-webhook/');
    expect(out).toContain('[REDACTED]');
  });

  it('режет во всех шести колбэках трендов', () => {
    for (const label of [
      'tg-webhook',
      'vk-webhook',
      'collect-trends-callback',
      'tg-find-groups-webhook',
      'vk-find-groups-webhook',
      'collect-comments-callback',
    ]) {
      const out = redactText(`https://smm.example.test/api/trends/${label}/${TOKEN}`);
      expect(out, label).not.toContain(TOKEN);
    }
  });

  it('не трогает обычные сегменты пути', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(redactText(`/api/campaigns/${uuid}/posts`)).toContain(uuid);
    expect(redactText('/api/trends/collect-direct')).toBe('/api/trends/collect-direct');
  });

  it('прежние правила не сломаны', () => {
    expect(redactText('access_token=SEKRET123')).toContain('[REDACTED]');
    expect(redactText('Authorization: Bearer abcdefghijklmno')).toContain('[REDACTED]');
    expect(redactText('https://api.example.com/v1?key=AIzaSyFAKE')).not.toContain('AIzaSyFAKE');
  });
});

describe('Host не участвует в построении URL', () => {
  it("req.get('host') читается только резолвером public-url", () => {
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rn', "-e", "req\\.get(['\"]host", "-e", "headers\\.host", 'server', '--include=*.ts'],
        { cwd: ROOT, encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status !== 1) throw e;
    }

    const offenders = out
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.startsWith('server/utils/public-url.ts'))
      .filter((line) => !line.includes('__tests__'));

    expect(offenders, 'Host должен читаться только в resolveRequestOrigin').toEqual([]);
  });
});
