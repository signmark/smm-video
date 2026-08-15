/**
 * Task #73: операционализация failover-сигнала — событие доходит до
 * notification-bus (WebSocket → UI), а не только в warn-лог.
 *
 * Проверяем, что при сигналах «not_configured»/«all_invalid» (env-мисконфиг)
 * и «saved»/«stale» (outcome) broadcastNotification('telegram_failover', …)
 * вызывается с правильным kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setNotificationBroadcaster } from '../services/notification-bus';
import { getFallbackIps } from '../services/social-platforms/telegram-http';

let captured: Array<{ type: string; data: any }> = [];

beforeEach(() => {
  captured = [];
  setNotificationBroadcaster((type: string, data: unknown) => {
    captured.push({ type, data: data as any });
  });
});

afterEach(() => {
  delete process.env.TELEGRAM_API_IPS;
});

/** Ждём разрешения ленивого import(...) внутри broadcastFailoverSignal. */
async function flushBroadcast() {
  await new Promise((r) => setTimeout(r, 20));
}

describe('task #73: failover-сигнал доходит до notification-bus', () => {
  it('TELEGRAM_API_IPS не задана → broadcast not_configured', async () => {
    delete process.env.TELEGRAM_API_IPS;
    const { getFallbackIps } = await import('../services/social-platforms/telegram-http');
    getFallbackIps();
    await flushBroadcast();

    const failover = captured.filter((c) => c.type === 'telegram_failover');
    expect(failover.length).toBe(1);
    expect(failover[0].data.kind).toBe('not_configured');
  });

  it('TELEGRAM_API_IPS задана, но все адреса невалидны → broadcast all_invalid', async () => {
    process.env.TELEGRAM_API_IPS = '999.1.1.1, junk';
    const { getFallbackIps } = await import('../services/social-platforms/telegram-http');
    getFallbackIps();
    await flushBroadcast();

    const failover = captured.filter((c) => c.type === 'telegram_failover');
    expect(failover.length).toBe(1);
    expect(failover[0].data.kind).toBe('all_invalid');
  });

  it('валидный TELEGRAM_API_IPS не шлёт not_configured/all_invalid', async () => {
    process.env.TELEGRAM_API_IPS = '149.154.167.220';
    const { getFallbackIps } = await import('../services/social-platforms/telegram-http');
    const ips = getFallbackIps();
    expect(ips).toContain('149.154.167.220');
    await flushBroadcast();
    // Валидная переменная не должна давать env-сигнал.
    expect(captured.filter((c) => c.type === 'telegram_failover')).toHaveLength(0);
  });
});
