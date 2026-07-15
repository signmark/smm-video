import { describe, expect, it, vi } from 'vitest';
import {
  broadcastNotification,
  setNotificationBroadcaster
} from '../services/notification-bus';

describe('notification bus', () => {
  it('forwards scheduler notifications to the registered transport', () => {
    const broadcaster = vi.fn();
    setNotificationBroadcaster(broadcaster);

    broadcastNotification('content_published', { contentId: 'content-1' });

    expect(broadcaster).toHaveBeenCalledWith('content_published', {
      contentId: 'content-1'
    });
  });
});
