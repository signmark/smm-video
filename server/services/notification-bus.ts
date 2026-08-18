import { logEvent } from '../utils/logger';

export type NotificationBroadcaster = (type: string, data: unknown) => void;

let broadcaster: NotificationBroadcaster = () => {};

export function setNotificationBroadcaster(nextBroadcaster: NotificationBroadcaster): void {
  broadcaster = nextBroadcaster;
}

export function broadcastNotification(type: string, data: unknown): void {
  broadcaster(type, data);
}

/**
 * AI-65. Уведомление о состоявшейся публикации.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ФУНКЦИЯ. В планировщике было одиннадцать одинаковых мест
 * вида `try { ...broadcastNotification... } catch {}`. Молчание там верное:
 * публикация к этому моменту уже состоялась и запись о ней сохранена, а
 * непоказанное уведомление её не отменяет — уронить публикацию из-за уведомления
 * было бы хуже. Но записанное одиннадцать раз пустым `catch {}` это решение
 * неотличимо от забытого. Теперь оно принято один раз и в одном месте.
 *
 * ТИШИНА НЕ ПОЛНАЯ. Отказ пишется на уровне отладки: он не касается человека —
 * его пост опубликован, — но если уведомления перестанут доходить у всех сразу,
 * причина должна найтись, а не выясняться заново.
 */
export function notifyPublished(data: {
  contentId: string;
  platform: string;
  type?: string;
  message?: string;
}): void {
  try {
    broadcastNotification('content_published', data);
  } catch (e: any) {
    logEvent(
      'notification.broadcast_failed',
      {
        contentId: data.contentId,
        platform: data.platform,
        reason: e?.message ? String(e.message) : 'unknown',
      },
      'debug',
      'notification',
    );
  }
}
