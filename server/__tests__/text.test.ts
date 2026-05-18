/**
 * Unit tests for server/utils/text.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupText, translateToEnglish } from '../utils/text';

vi.mock('../services/deepseek', () => ({
  deepseekService: {
    hasApiKey: vi.fn(),
    generateText: vi.fn(),
  },
}));

import { deepseekService } from '../services/deepseek';

describe('server/utils/text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEEPSEEK_API_KEY;
  });

  describe('cleanupText', () => {
    it('должен возвращать пустую строку для null', () => {
      expect(cleanupText(null)).toBe('');
    });

    it('должен возвращать пустую строку для undefined', () => {
      expect(cleanupText(undefined)).toBe('');
    });

    it('должен удалять HTML теги', () => {
      expect(cleanupText('<p>Hello</p>')).toBe('Hello');
      expect(cleanupText('<div><span>Text</span></div>')).toBe('Text');
    });

    it('должен заменять &nbsp; на пробел', () => {
      expect(cleanupText('Hello&nbsp;World')).toBe('Hello World');
    });

    it('должен удалять многоточие в конце строки', () => {
      expect(cleanupText('Text...')).toBe('Text');
    });

    it('должен удалять многоточие после переноса строки', () => {
      expect(cleanupText('Text\n...')).toBe('Text');
    });

    it('должен заменять множественные пробелы на один', () => {
      expect(cleanupText('Hello    World')).toBe('Hello World');
    });

    it('должен trim результат', () => {
      expect(cleanupText('  trimmed  ')).toBe('trimmed');
    });

    it('должен обрабатывать комбинацию преобразований', () => {
      expect(cleanupText('<p>  Hello&nbsp;World...  </p>')).toBe('Hello World');
    });
  });

  describe('translateToEnglish', () => {
    it('должен использовать базовый словарь когда DeepSeek недоступен', async () => {
      vi.mocked(deepseekService.hasApiKey).mockReturnValue(false);

      const result = await translateToEnglish('рецепты здоровое питание');

      expect(deepseekService.generateText).not.toHaveBeenCalled();
      expect(result).toContain('recipes');
      expect(result).toContain('healthy');
    });

    it('должен вызывать DeepSeek когда API ключ доступен', async () => {
      vi.mocked(deepseekService.hasApiKey).mockReturnValue(true);
      vi.mocked(deepseekService.generateText).mockResolvedValue('Translated text');

      const result = await translateToEnglish('Привет мир');

      expect(deepseekService.generateText).toHaveBeenCalled();
      expect(result).toBe('Translated text');
    });

    it('должен использовать DEEPSEEK_API_KEY из env', async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      vi.mocked(deepseekService.hasApiKey).mockReturnValue(true);
      vi.mocked(deepseekService.generateText).mockResolvedValue('Translated');

      await translateToEnglish('текст');

      expect(deepseekService.generateText).toHaveBeenCalled();
    });

    it('должен возвращать исходный текст при ошибке DeepSeek', async () => {
      vi.mocked(deepseekService.hasApiKey).mockReturnValue(true);
      vi.mocked(deepseekService.generateText).mockRejectedValue(new Error('API Error'));

      const result = await translateToEnglish('Ошибка');

      expect(result).toBe('Ошибка');
    });
  });
});
