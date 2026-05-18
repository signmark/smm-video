import * as logger from '../utils/logger.js';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';
import { vertexAIAuth } from './vertex-ai-auth.js';

/**
 * Реализация сервиса Gemini с поддержкой SOCKS5 прокси и правильной обработкой Vertex AI
 */
export class GeminiProxyService {
    /**
     * Определяет правильную версию API и URL для модели
     * @param model Название модели
     * @returns Объект с версией API и базовым URL
     */
    getApiVersionForModel(model) {
        // Gemini 2.5 модели требуют Vertex AI
        if (model === 'gemini-2.5-flash' || model === 'gemini-2.5-pro') {
            return {
                version: 'v1',
                baseUrl: vertexAIAuth.getVertexAIUrl(model),
                isVertexAI: true
            };
        }
        // Остальные модели используют стандартный Generative Language API
        return {
            version: 'v1',
            baseUrl: 'https://generativelanguage.googleapis.com/v1'
        };
    }

    /**
     * Преобразует упрощенные названия моделей в правильные названия API
     * @param model Упрощенное название модели
     * @returns Правильное название для API
     */
    mapModelToApiName(model) {
        const modelMap = {
            // Gemini 2.5 модели используют правильные названия для Vertex AI (из документации)
            'gemini-2.5-flash': 'gemini-2.5-flash',
            'gemini-2.5-pro': 'gemini-2.5-pro',
            // Gemini 1.5 модели (поддерживаемые)
            'gemini-2.0-flash': 'gemini-1.5-flash',
            'gemini-2.0-flash-lite': 'gemini-1.5-flash',
            // Gemini 1.5 модели
            'gemini-1.5-flash': 'gemini-1.5-flash-latest',
            'gemini-1.5-pro': 'gemini-1.5-pro-latest'
        };
        return modelMap[model] || model;
    }

    /**
     * Создает новый экземпляр GeminiProxyService
     * @param options Опции для инициализации сервиса
     */
    constructor(options) {
        this.maxRetries = 3;
        this.apiKey = options.apiKey;
        
        // ВРЕМЕННО ОТКЛЮЧЕН: прокси не работает в текущей среде
        this.agent = null;
        this.proxyUrl = null;
    }

    /**
     * Извлекает текст из ответа Gemini/Vertex AI с обработкой различных форматов ответов
     * @param response Ответ от API
     * @param url URL запроса (для повторных попыток)
     * @param requestData Данные запроса (для повторных попыток) 
     * @param isVertexAI Флаг Vertex AI
     * @returns Извлеченный текст
     */
    async extractTextFromResponse(response, url = null, requestData = null, isVertexAI = false) {
        if (!response.candidates || response.candidates.length === 0) {
            throw new Error('Ответ не содержит candidates');
        }

        const candidate = response.candidates[0];
        
        // Обрабатываем различные случаи finishReason
        if (candidate.finishReason === 'MAX_TOKENS' && url && requestData) {
            logger.warn(`[gemini-proxy] Достигнут лимит токенов, повторяем с меньшим лимитом`, 'gemini');
            
            // Повторяем запрос с меньшим количеством токенов
            const retryRequestData = {
                ...requestData,
                generationConfig: {
                    ...requestData.generationConfig,
                    maxOutputTokens: 2048  // Уменьшаем лимит
                }
            };
            
            const retryResponse = await this.sendRequest(url, retryRequestData, isVertexAI);
            return this.extractTextFromResponse(retryResponse); // Рекурсивный вызов без url чтобы избежать бесконечной рекурсии
        }

        // Проверяем наличие контента и частей
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            let resultText = candidate.content.parts[0].text || '';
            
            // Очищаем текст от артефактов
            resultText = resultText.replace(/<automatic_updates>[\s\S]*?<\/automatic_updates>/g, '');
            resultText = resultText.replace(/<[^>]*>/g, '');
            resultText = resultText.replace(/```html/g, '');
            resultText = resultText.replace(/```/g, '');
            resultText = resultText.replace(/^---\s*\n?/g, '');
            resultText = resultText.replace(/\n?\s*---\s*$/g, '');
            
            return resultText.trim();
        }

        // Vertex AI иногда возвращает пустой content но с finishReason
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            logger.warn(`[gemini-proxy] Vertex AI завершил генерацию с причиной: ${candidate.finishReason}`, 'gemini');
            
            // Для MAX_TOKENS без возможности повтора возвращаем сообщение об ошибке
            if (candidate.finishReason === 'MAX_TOKENS') {
                throw new Error('Vertex AI достиг лимита токенов. Попробуйте сократить запрос.');
            }
            
            // Для других случаев тоже бросаем ошибку с информативным сообщением
            throw new Error(`Vertex AI не смог сгенерировать ответ. Причина: ${candidate.finishReason}`);
        }

        throw new Error('Неожиданный формат ответа от Gemini API');
    }

    /**
     * Отправляет запрос к Gemini API через SOCKS5 прокси
     * @param url URL для запроса
     * @param body Тело запроса
     * @param isVertexAI Использовать ли Vertex AI
     * @returns Ответ от API в виде JSON
     */
    async sendRequest(url, body, isVertexAI = false) {
        let retries = 0;
        let lastError = null;
        
        // Создаем базовые опции один раз для использования в fallback
        const baseFetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        };
        
        while (retries < this.maxRetries) {
            try {
                // Маскируем API ключ в URL для логов
                const safeUrl = url.replace(/key=[^&]+/, 'key=****');
                logger.log(`[gemini-proxy] Отправка запроса к: ${safeUrl}`, 'gemini');
                const fetchOptions = { ...baseFetchOptions };
                
                // Для Vertex AI используем Service Account авторизацию
                if (url.includes('aiplatform.googleapis.com')) {
                    logger.log(`[gemini-proxy] Используется Vertex AI, получаем Service Account токен`, 'gemini');
                    logger.log(`[gemini-proxy] Данные для Vertex AI: ${JSON.stringify(body, null, 2)}`, 'gemini');
                    const accessToken = await vertexAIAuth.getAccessToken();
                    if (accessToken) {
                        fetchOptions.headers = {
                            ...fetchOptions.headers,
                            'Authorization': `Bearer ${accessToken}`
                        };
                        // Service Account токен добавлен для Vertex AI
                    }
                    else {
                        throw new Error('Не удалось получить Service Account токен для Vertex AI');
                    }
                }
                
                // Для Vertex AI не используем прокси (работает напрямую на staging)
                if (url.includes('aiplatform.googleapis.com')) {
                    // Vertex AI запрос через прямое соединение
                } else if (this.agent) {
                    // Используем прокси только для стандартного Gemini API
                    fetchOptions.agent = this.agent;
                    logger.log(`[gemini-proxy] Стандартный Gemini API - используется SOCKS5 прокси: ${this.proxyUrl?.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`, 'gemini');
                } else {
                    logger.warn(`[gemini-proxy] ⚠️ ПРОКСИ НЕДОСТУПЕН для стандартного Gemini API!`, 'gemini');
                }
                
                // Выполняем запрос
                const response = await fetch(url, fetchOptions);
                const status = response.status;
                
                // Получен ответ от API
                if (status === 200) {
                    // Успешный ответ
                    const data = await response.json();
                    return data;
                }
                else {
                    // Обрабатываем ошибку
                    const errorText = await response.text();
                    throw new Error(`HTTP error ${status}: ${errorText}`);
                }
            }
            catch (error) {
                lastError = error;
                retries++;
                logger.error(`[gemini-proxy] Попытка ${retries} не удалась: ${error.message}`, 'gemini');
                
                // Пробуем fallback только при первой ошибке и только для Vertex AI
                if (retries === 1 && url.includes('aiplatform.googleapis.com')) {
                    try {
                        // Для fallback нужно использовать standard Gemini API, а не Vertex AI
                        let fallbackUrl = url;
                        let fallbackOptions = { ...baseFetchOptions };
                        
                        // Если это был запрос к Vertex AI, переключаемся на стандартный Gemini API
                        if (url.includes('aiplatform.googleapis.com')) {
                            // Извлекаем модель из Vertex URL
                            const modelMatch = url.match(/models\/([^:]+):/);
                            const model = modelMatch ? modelMatch[1] : 'gemini-1.5-flash';
                            
                            // Переключаемся на стандартный Gemini API
                            fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
                            
                            // Убираем Service Account заголовки для стандартного API
                            fallbackOptions.headers = {
                                'Content-Type': 'application/json'
                            };
                            
                            logger.log(`[gemini-proxy] Переключаемся с Vertex AI на стандартный Gemini API: ${model}`, 'gemini');
                        }
                        
                        // НЕ используем agent (прокси) для fallback запроса
                        delete fallbackOptions.agent;
                        
                        const fallbackResponse = await fetch(fallbackUrl, fallbackOptions);
                        const status = fallbackResponse.status;
                        // Fallback ответ получен
                        
                        if (status === 200) {
                            const data = await fallbackResponse.json();
                            logger.log(`[gemini-proxy] ✅ Fallback успешен - стандартный Gemini API работает`, 'gemini');
                            return data;
                        } else {
                            const errorText = await fallbackResponse.text();
                            logger.error(`[gemini-proxy] ❌ Fallback статус ${status}: ${errorText}`, 'gemini');
                            throw new Error(`HTTP error ${status}: ${errorText}`);
                        }
                    } catch (fallbackError) {
                        logger.error(`[gemini-proxy] ❌ Fallback также неудачен: ${fallbackError.message}`, 'gemini');
                        // Продолжаем к обычной обработке ошибки
                    }
                }
                
                if (retries < this.maxRetries) {
                    const backoffTime = Math.pow(2, retries) * 500; // Экспоненциальная задержка
                    logger.warn(`[gemini-proxy] Попытка ${retries} из ${this.maxRetries} не удалась. Повтор через ${backoffTime}ms. Ошибка: ${lastError.message}`, 'gemini');
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                }
            }
        }
        
        // Если все попытки неудачны
        throw new Error(`[gemini-proxy] Максимальное количество попыток исчерпано. Последняя ошибка: ${lastError?.message || 'Неизвестная ошибка'}`);
    }

    /**
     * Генерирует текст с помощью Gemini API
     * @param params Параметры для генерации текста
     * @returns Сгенерированный текст
     */
    async generateText(params) {
        try {
            // Если передана строка вместо объекта, используем её как prompt
            let prompt, model;
            if (typeof params === 'string') {
                prompt = params;
                model = 'gemini-2.0-flash-exp';
            } else {
                prompt = params.prompt;
                model = params.model || 'gemini-2.0-flash-exp';
            }
            
            logger.log(`[gemini-proxy] Generating text with model: ${model}, prompt: "${prompt?.substring(0, 100)}..."`, 'gemini');
            
            // Преобразуем модель в правильное название API
            const apiModel = this.mapModelToApiName(model);
            logger.log(`[gemini-proxy] Mapped model ${model} to API model: ${apiModel}`, 'gemini');
            
            // Определяем правильную версию API для модели
            const { baseUrl, isVertexAI } = this.getApiVersionForModel(apiModel);
            logger.log(`[gemini-proxy] API версия: baseUrl=${baseUrl}, isVertexAI=${isVertexAI}`, 'gemini');
            
            let url;
            if (isVertexAI) {
                // Для Vertex AI baseUrl уже содержит полный путь с моделью
                url = baseUrl;
            }
            else {
                // Для генеративного API используем стандартный формат
                url = `${baseUrl}/models/${apiModel}:generateContent?key=${this.apiKey}`;
            }
            
            // Проверяем что prompt не пустой
            if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
                throw new Error('Prompt не может быть пустым');
            }
            
            logger.log(`[gemini-proxy] Отправляем prompt длиной: ${prompt.length} символов`, 'gemini');
            
            // Формируем запрос
            const requestData = {
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: prompt.trim()
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    topK: 40,
                    maxOutputTokens: 8192
                }
            };
            
            // Отправляем запрос
            const response = await this.sendRequest(url, requestData, isVertexAI);
            
            // Используем новый метод извлечения текста с обработкой Vertex AI
            return this.extractTextFromResponse(response, url, requestData, isVertexAI);
        }
        catch (error) {
            logger.error(`[gemini-proxy] Ошибка при генерации текста: ${error.message}`, 'gemini');
            throw error;
        }
    }

    /**
     * Улучшает текст с помощью Gemini API
     * @param params Параметры для улучшения текста
     * @returns Улучшенный текст
     */
    async improveText(params) {
        try {
            const { text, prompt, model = 'gemini-2.5-flash' } = params;
            logger.log(`[gemini-proxy] Improving text with model: ${model}`, 'gemini');
            
            // Преобразуем модель в правильное название API
            const apiModel = this.mapModelToApiName(model);
            logger.log(`[gemini-proxy] Mapped model ${model} to API model: ${apiModel}`, 'gemini');
            
            // Определяем правильную версию API для модели
            const { baseUrl, isVertexAI } = this.getApiVersionForModel(apiModel);
            
            let url;
            if (isVertexAI) {
                // Для Vertex AI baseUrl уже содержит полный путь с моделью
                url = baseUrl;
            }
            else {
                // Для генеративного API используем стандартный формат
                url = `${baseUrl}/models/${apiModel}:generateContent?key=${this.apiKey}`;
            }
            
            // Формируем запрос
            const requestData = {
                contents: [
                    {
                        parts: [
                            {
                                text: `${prompt}\n\n${text}`
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.4,
                    topP: 0.9,
                    topK: 40,
                    maxOutputTokens: 8192
                }
            };
            
            // Отправляем запрос
            const response = await this.sendRequest(url, requestData, isVertexAI);
            
            // Используем новый метод извлечения текста с обработкой Vertex AI
            return this.extractTextFromResponse(response, url, requestData, isVertexAI);
        }
        catch (error) {
            logger.error(`[gemini-proxy] Ошибка при улучшении текста: ${error.message}`, 'gemini');
            throw error;
        }
    }

    /**
     * Тестирует доступность API Gemini и валидность API ключа
     * @returns true если API ключ действителен и доступен, иначе false
     */
    async testApiKey() {
        try {
            // URL для запроса к API Gemini (обновлено на v1beta для поддержки Gemini 2.5)
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`;
            
            // Тестовый промпт
            const requestData = {
                contents: [
                    {
                        parts: [
                            {
                                text: "Hello, this is a test message."
                            }
                        ]
                    }
                ]
            };
            
            // Отправляем запрос
            await this.sendRequest(url, requestData, false);
            return true;
        }
        catch (error) {
            logger.error(`[gemini-proxy] Ошибка при тестировании API ключа: ${error.message}`, 'gemini');
            return false;
        }
    }
}

// Создаем глобальный экземпляр сервиса с использованием API ключа из переменных окружения
export const geminiProxyService = new GeminiProxyService({
    apiKey: process.env.GEMINI_API_KEY
});

// Выводим информацию об инициализации сервиса с API ключом (скрываем полный ключ для безопасности)
const maskedKey = geminiProxyService.apiKey ? 
    `${geminiProxyService.apiKey.substring(0, 10)}...${geminiProxyService.apiKey.slice(-10)}` : 
    'НЕ УСТАНОВЛЕН';
logger.log(`[gemini-proxy] ✅ Сервис Gemini Proxy инициализирован с API ключом: ${maskedKey}`, 'gemini');