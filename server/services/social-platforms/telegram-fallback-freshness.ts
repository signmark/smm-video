/**
 * Проверка свежести запасных адресов Telegram (task #73, вариантив в).
 *
 * Запасные адреса живут не вечно: закреплённый на прод-хосте IP может перестать
 * отвечать, и тогда список TELEGRAM_API_IPS «протухает» — тихий отказ, который
 * в логах неотличим от «запас не понадобился». Этот модуль даёт способ проверки:
 * для каждого адреса из переменной делается TLS-рукопожатие с SNI
 * api.telegram.org и `rejectUnauthorized: true` (ровно так, как ходит сам
 * транспорт). Отвечает — fresh; таймаут/ошибка — stale.
 *
 * Для тестируемости classification вынесена в чистую функцию
 * `classifyFallbackFreshness`, а реальный сетевой зонд — в
 * `probeTelegramIp`. Тест мокает зонд, поэтому живого трафика в тестах нет.
 */
import * as tls from 'tls';

export const TELEGRAM_SNI = 'api.telegram.org';
export const TELEGRAM_PORT = 443;
export const PROBE_TIMEOUT_MS = 5000;

export type FreshnessStatus = 'fresh' | 'stale';

export interface FallbackFreshnessResult {
  ip: string;
  status: FreshnessStatus;
  detail: string;
}

/** Тип зонда — чтобы тест мог подставить детерминированный мок. */
export type IpProbe = (ip: string) => Promise<{ ok: boolean; detail: string }>;

/**
 * Чистая классификация: берёт список адресов и зонд, возвращает результат по
 * каждому. Не зависит от сети — зонд инжектируется.
 */
export async function classifyFallbackFreshness(
  ips: string[],
  probe: IpProbe = probeTelegramIp,
): Promise<FallbackFreshnessResult[]> {
  const results: FallbackFreshnessResult[] = [];
  for (const ip of ips) {
    const { ok, detail } = await probe(ip);
    results.push({ ip, status: ok ? 'fresh' : 'stale', detail });
  }
  return results;
}

/**
 * Реальный зонд: TLS-рукопожатие с SNI api.telegram.org и проверкой сертификата
 * (`rejectUnauthorized: true`) — тот же путь, что у транспорта. Рукопожатие
 * завершилось — адрес жив; ошибка/таймаут — протух.
 */
export function probeTelegramIp(ip: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };

    const socket = tls.connect({
      host: ip,
      port: TELEGRAM_PORT,
      servername: TELEGRAM_SNI,
      rejectUnauthorized: true,
    });

    const timer = setTimeout(() => {
      finish(false, `timeout ${timeoutMs}ms`);
      socket.destroy();
    }, timeoutMs);

    socket.once('secureConnect', () => {
      clearTimeout(timer);
      finish(true, 'TLS ok');
      socket.destroy();
    });
    socket.once('error', (err: any) => {
      clearTimeout(timer);
      finish(false, err?.code || err?.message || 'TLS error');
      socket.destroy();
    });
  });
}
