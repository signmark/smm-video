/**
 * task #73: проверка свежести запасных адресов — классификация (мок-зонд).
 *
 * Реального сетевого трафика нет: зонд инжектируется, проверяем только
 * классификацию fresh/stale и привязку причины к адресу.
 */
import { describe, it, expect } from 'vitest';
import { classifyFallbackFreshness, TELEGRAM_SNI, TELEGRAM_PORT } from '../services/social-platforms/telegram-fallback-freshness';

const okProbe = (ip: string) => Promise.resolve({ ok: true, detail: `TLS ok ${ip}` });
const deadProbe = (ip: string) => Promise.resolve({ ok: false, detail: `ECONNREFUSED ${ip}` });

describe('task #73: classifyFallbackFreshness', () => {
  it('живые адреса → fresh', async () => {
    const r = await classifyFallbackFreshness(['149.154.167.220', '149.154.166.110'], okProbe);
    expect(r.map((x) => x.status)).toEqual(['fresh', 'fresh']);
  });

  it('мёртвые адреса → stale с причиной', async () => {
    const r = await classifyFallbackFreshness(['1.2.3.4'], deadProbe);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('stale');
    expect(r[0].detail).toContain('ECONNREFUSED');
    expect(r[0].ip).toBe('1.2.3.4');
  });

  it('смешанный список: каждый адрес классифицирован отдельно', async () => {
    const mixed = (ip: string) => ip === '149.154.167.220'
      ? Promise.resolve({ ok: true, detail: 'TLS ok' })
      : Promise.resolve({ ok: false, detail: 'ETIMEDOUT' });
    const r = await classifyFallbackFreshness(['149.154.167.220', '10.0.0.1'], mixed);
    expect(r[0].status).toBe('fresh');
    expect(r[1].status).toBe('stale');
    expect(r[1].detail).toContain('ETIMEDOUT');
  });

  it('константы зонда совпадают с транспортом', () => {
    // Зонд обязан ходить с тем же SNI и портом, что и сам failover-транспорт.
    expect(TELEGRAM_SNI).toBe('api.telegram.org');
    expect(TELEGRAM_PORT).toBe(443);
  });
});
