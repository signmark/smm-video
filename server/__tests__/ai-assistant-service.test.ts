import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIAssistantService } from '../services/ai-assistant/index';
import { handleAutonomousAIWithAPI } from '../services/ai-assistant/autonomous';
import { aiRoutingAnalyzeCommand } from '../services/ai-assistant/command-routing';

// Mock storage and other dependencies
vi.mock('../services/ai-conversation-storage', () => ({
  aiConversationStorage: {
    loadHistory: vi.fn().mockResolvedValue([]),
    saveMessage: vi.fn().mockResolvedValue({}),
    formatHistoryForAI: vi.fn().mockReturnValue([])
  }
}));

vi.mock('../services/ai-assistant/autonomous', () => ({
  handleAutonomousAIWithAPI: vi.fn()
}));

vi.mock('../services/ai-assistant/command-routing', () => ({
  aiRoutingAnalyzeCommand: vi.fn(),
  initializeAvailableFunctions: vi.fn().mockReturnValue([])
}));

vi.mock('../services/ai-assistant/command-handlers', () => ({
  handleHelp: vi.fn().mockResolvedValue({ response: 'help', success: true }),
  handleUnknownCommand: vi.fn().mockResolvedValue({ response: 'unknown', success: false }),
  handleFillQuestionnaire: vi.fn()
}));

describe('AIAssistantService', () => {
  let service: AIAssistantService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIAssistantService();
  });

  describe('processCommand', () => {
    it('should trigger tutorial when keyword matches', async () => {
      const result = await service.processCommand({
        message: 'хочу пройти обучение',
        userId: 'u1'
      });

      expect(result.interactive?.type).toBe('welcome-tutorial');
      expect(result.response).toContain('Добро пожаловать');
    });

    it('should show campaign options for message with URL and create intent', async () => {
      const result = await service.processCommand({
        message: 'создай новую кампанию для сайта https://magnus.dev',
        userId: 'u1'
      });

      expect(result.interactive?.type).toBe('campaign-options');
      expect(result.interactive?.campaignOptions?.websiteUrl).toBe('https://magnus.dev');
      expect(result.interactive?.campaignOptions?.name).toBe('Кампания для magnus.dev');
    });

    it('should extract campaign name if provided in quotes', async () => {
      const result = await service.processCommand({
        message: 'создай кампанию "Мой крутой проект" для сайта https://cool.com',
        userId: 'u1'
      });

      expect(result.interactive?.campaignOptions?.name).toBe('Мой крутой проект');
    });

    it('should load and save history if userId is provided', async () => {
      const { aiConversationStorage } = await import('../services/ai-conversation-storage');
      vi.mocked(handleAutonomousAIWithAPI).mockResolvedValue({
        response: 'AI response',
        success: true
      });

      await service.processCommand({
        message: 'test message',
        userId: 'u1'
      });

      expect(aiConversationStorage.loadHistory).toHaveBeenCalledWith('u1', undefined, 9);
      expect(aiConversationStorage.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'u1',
        content: 'test message',
        role: 'user'
      }));
      expect(aiConversationStorage.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'u1',
        content: 'AI response',
        role: 'assistant'
      }));
    });

    it('should use fallback and call correct handler for fill_questionnaire', async () => {
      const { handleFillQuestionnaire } = await import('../services/ai-assistant/command-handlers');
      vi.mocked(handleAutonomousAIWithAPI).mockRejectedValue(new Error('AI failed'));
      vi.mocked(aiRoutingAnalyzeCommand).mockResolvedValue({
        intent: 'fill_questionnaire',
        confidence: 0.9,
        parameters: {}
      } as any);
      vi.mocked(handleFillQuestionnaire).mockResolvedValue({ response: 'questionnaire started', success: true });

      const result = await service.processCommand({
        message: 'заполни анкету',
        userId: 'u1'
      });

      expect(handleFillQuestionnaire).toHaveBeenCalled();
      expect(result.response).toBe('questionnaire started');
    });

    it('should return error response if everything fails', async () => {
      vi.mocked(handleAutonomousAIWithAPI).mockRejectedValue(new Error('Autonomous failed'));
      vi.mocked(aiRoutingAnalyzeCommand).mockRejectedValue(new Error('Routing failed'));

      const result = await service.processCommand({
        message: 'сломайся',
        userId: 'u1'
      });

      expect(result.success).toBe(false);
      expect(result.response).toContain('Извините, произошла ошибка');
    });

    it('should use autonomous AI system by default', async () => {
      vi.mocked(handleAutonomousAIWithAPI).mockResolvedValue({
        response: 'autonomous response',
        success: true
      });

      const result = await service.processCommand({
        message: 'сделай что-нибудь',
        userId: 'u1'
      });

      expect(handleAutonomousAIWithAPI).toHaveBeenCalled();
      expect(result.response).toBe('autonomous response');
    });

    it('should fallback to intent routing if autonomous AI fails', async () => {
      vi.mocked(handleAutonomousAIWithAPI).mockRejectedValue(new Error('AI failed'));
      vi.mocked(aiRoutingAnalyzeCommand).mockResolvedValue({
        intent: 'help',
        confidence: 0.9,
        parameters: {}
      } as any);

      const result = await service.processCommand({
        message: 'помощь',
        userId: 'u1'
      });

      expect(aiRoutingAnalyzeCommand).toHaveBeenCalled();
      expect(result.response).toBe('help');
    });
  });
});
