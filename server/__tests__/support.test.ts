import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supportService } from '../services/support';
import { getTelegramBot } from '../telegram-bot/bot-launcher';

// Mock dependencies
vi.mock('../telegram-bot/bot-launcher', () => ({
  getTelegramBot: vi.fn()
}));

describe('SupportService', () => {
  const mockMessage = {
    userId: 'user-123',
    message: 'Help me please!'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send notification to admin via telegram bot', async () => {
    const mockBot = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 })
    };
    vi.mocked(getTelegramBot).mockReturnValue(mockBot as any);

    const result = await supportService.sendSupportMessage(mockMessage);

    expect(result.ticketId).toBeDefined();
    expect(mockBot.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('user-123')
    );
    expect(mockBot.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Help me please!')
    );
  });

  it('should handle case when telegram bot is not initialized', async () => {
    vi.mocked(getTelegramBot).mockReturnValue(null);

    const result = await supportService.sendSupportMessage(mockMessage);

    expect(result.ticketId).toBeDefined();
    // Should not throw and just log warning
  });
});
