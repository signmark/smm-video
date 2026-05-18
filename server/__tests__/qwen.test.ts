import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { QwenService } from '../services/qwen';
import { apiKeyService, ApiServiceName } from '../services/api-keys';

vi.mock('axios');
vi.mock('../services/api-keys', () => ({
    apiKeyService: {
        getApiKey: vi.fn()
    },
    ApiServiceName: {
        QWEN: 'qwen'
    }
}));
vi.mock('../utils/logger');

describe('QwenService', () => {
    let qwenService: QwenService;
    const mockApiKey = 'test-api-key';

    beforeEach(() => {
        vi.clearAllMocks();
        qwenService = new QwenService({ apiKey: mockApiKey });
    });

    describe('generateText', () => {
        it('should generate text from prompt string', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    choices: [
                        {
                            message: {
                                content: '--- Generated content ---'
                            }
                        }
                    ]
                }
            };
            vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

            const result = await qwenService.generateText('Hello');
            expect(result).toBe('Generated content');
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/chat/completions'),
                expect.objectContaining({
                    messages: [{ role: 'user', content: 'Hello' }]
                }),
                expect.any(Object)
            );
        });

        it('should generate text from messages array', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    choices: [
                        {
                            message: {
                                content: '"""Response"""'
                            }
                        }
                    ]
                }
            };
            vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

            const result = await qwenService.generateText([{ role: 'user', content: 'Hi' }]);
            expect(result).toBe('Response');
        });

        it('should throw error if apiKey is missing', async () => {
            const savedKey = process.env.QWEN_API_KEY;
            delete process.env.QWEN_API_KEY;
            const emptyService = new QwenService({ apiKey: '' });
            await expect(emptyService.generateText('test')).rejects.toThrow('Qwen API ключ не установлен');
            if (savedKey !== undefined) process.env.QWEN_API_KEY = savedKey;
        });

        it('should handle API errors', async () => {
            vi.mocked(axios.post).mockRejectedValueOnce({
                response: {
                    status: 401,
                    data: { error: { message: 'Invalid API key' } }
                }
            });

            await expect(qwenService.generateText('test')).rejects.toThrow('Недействительный API ключ Qwen');
        });

        it('should handle network errors', async () => {
            vi.mocked(axios.post).mockRejectedValueOnce({ code: 'ECONNREFUSED', message: 'Connection failed' });
            await expect(qwenService.generateText('test')).rejects.toThrow('Не удалось подключиться к Qwen API');
        });
    });

    describe('generateSocialContent', () => {
        it('should generate social content with correct parameters', async () => {
            vi.mocked(axios.post).mockResolvedValueOnce({
                data: {
                    choices: [{ message: { content: 'Social Post' } }]
                }
            });

            const result = await qwenService.generateSocialContent(['test'], ['topic'], 'instagram');
            expect(result).toBe('Social Post');
            expect(axios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    temperature: 0.7
                }),
                expect.any(Object)
            );
        });
    });

    describe('initialize', () => {
        it('should initialize with API key from apiKeyService', async () => {
            vi.mocked(apiKeyService.getApiKey).mockResolvedValueOnce('new-key');
            const initialized = await qwenService.initialize('user-1');
            expect(initialized).toBe(true);
            expect(qwenService.hasApiKey()).toBe(true);
        });

        it('should return false if API key not found', async () => {
            vi.mocked(apiKeyService.getApiKey).mockResolvedValueOnce(null);
            const initialized = await qwenService.initialize('user-1');
            expect(initialized).toBe(false);
        });
    });
});
