import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateAndNormalizeParameters, initializeAvailableFunctions } from '../services/ai-assistant/command-routing';
import { sanitizeContent, generatePostTitle } from '../services/ai-assistant/command-handlers';
import { shouldUseAutonomousAI, getActionName, getSuccessMessage } from '../services/ai-assistant/autonomous';
import { AvailableFunction } from '../services/ai-assistant/types';

// Mock geminiVertexDirect for generatePostTitle
vi.mock('../services/gemini-vertex-direct', () => ({
  geminiVertexDirect: {
    generateContent: vi.fn(),
  },
}));

import { geminiVertexDirect } from '../services/gemini-vertex-direct';

describe('ai-assistant logic', () => {
  describe('validateAndNormalizeParameters', () => {
    let availableFunctions: AvailableFunction[];

    beforeEach(() => {
      availableFunctions = initializeAvailableFunctions();
    });

    it('should return empty object for unknown intent', () => {
      const result = validateAndNormalizeParameters('unknown_intent', {}, availableFunctions);
      expect(result).toEqual({});
    });

    it('should apply default values for missing parameters', () => {
      const result = validateAndNormalizeParameters('create_posts', {}, availableFunctions);
      expect(result.count).toBe(1);
      expect(result.generateImages).toBe(true);
      expect(result.isConnectedSeries).toBe(false);
    });

    it('should cap "count" parameter between 1 and 10', () => {
      const lowResult = validateAndNormalizeParameters('create_posts', { count: 0 }, availableFunctions);
      expect(lowResult.count).toBe(1);

      const highResult = validateAndNormalizeParameters('create_posts', { count: 100 }, availableFunctions);
      expect(highResult.count).toBe(10);
    });

    it('should normalize platforms array', () => {
      const result = validateAndNormalizeParameters('schedule_posts', { 
        platforms: ['Instagram', 'InvalidPlatform', 'VK'] 
      }, availableFunctions);
      
      expect(result.platforms).toContain('Instagram');
      expect(result.platforms).toContain('VK');
      expect(result.platforms).not.toContain('InvalidPlatform');
    });

    it('should handle string to number conversion for count', () => {
      const result = validateAndNormalizeParameters('create_posts', { count: '5' }, availableFunctions);
      expect(result.count).toBe(5);
    });

    it('should limit string length to 500 characters', () => {
      const longTopic = 'a'.repeat(600);
      const result = validateAndNormalizeParameters('create_posts', { topic: longTopic }, availableFunctions);
      expect(result.topic.length).toBe(500);
    });
  });

  describe('sanitizeContent', () => {
    it('should strip markdown formatting', () => {
      const input = '**Bold** and *Italic* with `code`';
      const output = sanitizeContent(input);
      expect(output).toBe('Bold and Italic with code');
    });

    it('should strip HTML tags', () => {
      const input = '<p>Hello <b>World</b></p>';
      const output = sanitizeContent(input);
      expect(output).toBe('Hello World');
    });

    it('should resolve common HTML entities', () => {
      const input = 'Hello&nbsp;World &amp; friends';
      const output = sanitizeContent(input);
      expect(output).toBe('Hello World & friends');
    });

    it('should collapse multiple newlines and spaces', () => {
      const input = 'Too many    spaces\n\n\nand newlines';
      const output = sanitizeContent(input);
      expect(output).toBe('Too many spaces and newlines');
    });

    it('should strip code blocks including markers', () => {
      const input = 'Here is code:\n```javascript\nconsole.log("test");\n```\nDone.';
      const output = sanitizeContent(input);
      expect(output).toContain('Here is code:');
      expect(output).toContain('console.log("test");');
      expect(output).not.toContain('```');
    });
  });

  describe('shouldUseAutonomousAI', () => {
    it('should detect autonomous keywords', () => {
      expect(shouldUseAutonomousAI('собери тренды для меня')).toBe(true);
      expect(shouldUseAutonomousAI('найди ключевые слова')).toBe(true);
      expect(shouldUseAutonomousAI('проанализируй сайт https://google.com')).toBe(true);
    });

    it('should return false for regular commands', () => {
      expect(shouldUseAutonomousAI('привет')).toBe(false);
      expect(shouldUseAutonomousAI('создай пост')).toBe(false);
    });
  });

  describe('helper functions', () => {
    it('getActionName should return correct names', () => {
      expect(getActionName('getKeywords')).toBe('Анализ ключевых слов');
      expect(getActionName('collectTrends')).toBe('Сбор трендов');
      expect(getActionName('unknown')).toBe('unknown');
    });

    it('getSuccessMessage should format messages', () => {
      const msg = getSuccessMessage('getKeywords', { keywords: [1, 2, 3] });
      expect(msg).toContain('3');
      expect(msg).toContain('ключевых слов');
    });
  });

  describe('generatePostTitle', () => {
    it('should return cleaned title from AI', async () => {
      vi.mocked(geminiVertexDirect.generateContent).mockResolvedValue('"Цепляющий Заголовок"');
      const title = await generatePostTitle('Тема', 1, 'Контент поста');
      expect(title).toBe('Цепляющий Заголовок');
    });

    it('should fallback to first sentence if AI title is invalid', async () => {
      vi.mocked(geminiVertexDirect.generateContent).mockResolvedValue('No');
      const title = await generatePostTitle('Тема', 1, 'Это очень длинное и интересное первое предложение. Второе предложение.');
      expect(title).toBe('Это очень длинное и интересное первое предложение');
    });
  });
});
