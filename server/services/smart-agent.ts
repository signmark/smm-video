import { storage } from '../storage';
import { 
  type BotActionAttempt,
  type BotActionOutcome,
  type BotOutcomeType,
  type BotErrorCode,
  type BotPattern
} from '@shared/schema';
import { v4 as uuidv4 } from 'uuid';

export interface SmartAgentOptions {
  epsilon?: number; // Exploration rate (0.1 = 10% random exploration)
  maxRetries?: number; // Maximum number of automatic retries
  retryDelayMs?: number; // Delay between retries
  enableLearning?: boolean; // Enable/disable learning
}

export interface SmartAgentContext {
  userId?: string;
  campaignId?: string;
  platform?: string;
  [key: string]: any;
}

export type SmartAgentFunction<T> = (params: Record<string, any>) => Promise<T>;

export class SmartAgent {
  private options: Required<SmartAgentOptions>;

  constructor(options: SmartAgentOptions = {}) {
    this.options = {
      epsilon: options.epsilon ?? 0.1,
      maxRetries: options.maxRetries ?? 2,
      retryDelayMs: options.retryDelayMs ?? 1000,
      enableLearning: options.enableLearning ?? true
    };
  }

  /**
   * Выполняет операцию с автоматическим обучением и повторами
   */
  async run<T>(
    actionName: string,
    context: SmartAgentContext,
    defaultParams: Record<string, any>,
    operation: SmartAgentFunction<T>
  ): Promise<T> {
    const contextSignature = this.createContextSignature(actionName, context);
    const traceId = uuidv4();
    
    console.log(`[SmartAgent] Starting operation: ${actionName} (${traceId})`);

    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount <= this.options.maxRetries) {
      let params: Record<string, any>;
      let attempt: BotActionAttempt;
      let startedAt: number = Date.now();
      
      try {
        // Выбираем параметры для выполнения (с использованием обучения или по умолчанию)
        params = await this.selectParameters(actionName, contextSignature, defaultParams, retryCount);
        
        startedAt = Date.now();
        
        // Записываем попытку
        attempt = {
          traceId,
          actionName,
          contextSignature,
          params,
          startTime: new Date(startedAt)
        };

        if (this.options.enableLearning) {
          await storage.recordBotAttempt(attempt);
        }
        
        // Выполняем операцию
        const result = await operation(params);
        
        const durationMs = Date.now() - startedAt;

        // Записываем успешный результат
        if (this.options.enableLearning) {
          const outcome: BotActionOutcome = {
            ...attempt,
            outcomeType: 'success',
            errorCode: null,
            errorDetails: undefined,
            durationMs,
            reward: this.calculateReward('success', durationMs, retryCount),
            endTime: new Date()
          };

          await storage.recordBotOutcome(outcome);
        }

        console.log(`[SmartAgent] Success: ${actionName} (${traceId}) in ${durationMs}ms`);
        return result;

      } catch (error) {
        lastError = error as Error;
        const durationMs = Date.now() - startedAt;
        
        // Классифицируем ошибку
        const errorCode = this.classifyError(error);
        const errorDetails = this.sanitizeErrorMessage(error);

        console.warn(`[SmartAgent] Attempt ${retryCount + 1} failed: ${actionName} - ${errorCode}: ${errorDetails}`);

        // Записываем неуспешный результат с фактически использованными параметрами
        if (this.options.enableLearning && attempt!) {
          const outcome: BotActionOutcome = {
            ...attempt,
            outcomeType: 'fail',
            errorCode,
            errorDetails,
            durationMs,
            reward: this.calculateReward('fail', durationMs, retryCount),
            endTime: new Date()
          };

          await storage.recordBotOutcome(outcome);
        }

        // Проверяем, стоит ли повторить попытку
        if (!this.shouldRetry(errorCode, retryCount)) {
          break;
        }

        retryCount++;
        
        // Ждем перед повтором
        if (retryCount <= this.options.maxRetries) {
          const delay = this.calculateRetryDelay(errorCode, retryCount);
          console.log(`[SmartAgent] Retrying ${actionName} in ${delay}ms (attempt ${retryCount + 1})`);
          await this.delay(delay);
        }
      }
    }

    // Все попытки исчерпаны
    console.error(`[SmartAgent] Failed: ${actionName} after ${retryCount} attempts`);
    throw lastError || new Error(`Operation failed after ${retryCount} attempts`);
  }

  /**
   * Выбирает параметры для выполнения операции на основе обученных паттернов
   */
  private async selectParameters(
    actionName: string,
    contextSignature: string,
    defaultParams: Record<string, any>,
    retryCount: number
  ): Promise<Record<string, any>> {
    if (!this.options.enableLearning) {
      return defaultParams;
    }

    // На повторных попытках увеличиваем шанс exploration, но ограничиваем максимум
    const epsilon = Math.min(0.9, this.options.epsilon + (retryCount * 0.1));
    
    // Ищем лучшие паттерны для этого действия и контекста
    const topPatterns = await storage.getTopBotPatterns(actionName, contextSignature, 5);
    
    // Ищем также похожие контексты для большего разнообразия
    const similarPatterns = await storage.findSimilarContexts(actionName, contextSignature, 3);
    
    // Объединяем все доступные паттерны
    const allPatterns = [...topPatterns, ...similarPatterns];
    
    // Epsilon-greedy: exploration vs exploitation
    if (Math.random() < epsilon) {
      console.log(`[SmartAgent] Using exploration (ε=${epsilon.toFixed(2)})`);
      
      if (allPatterns.length > 0) {
        // Выбираем случайный из изученных паттернов (но не тот же, что использовали в предыдущей попытке)
        const availablePatterns = retryCount > 0 ? 
          allPatterns.slice(retryCount) : allPatterns;
        
        if (availablePatterns.length > 0) {
          const randomPattern = availablePatterns[Math.floor(Math.random() * availablePatterns.length)];
          console.log(`[SmartAgent] Exploring with random pattern (score: ${randomPattern.score.toFixed(2)})`);
          return Object.assign({}, defaultParams, randomPattern.params);
        }
      }
      
      // Если нет паттернов для exploration, используем defaults
      console.log(`[SmartAgent] Exploring with defaults (no patterns available)`);
      return defaultParams;
    }

    // Exploitation: используем лучший доступный паттерн
    if (topPatterns.length === 0) {
      console.log(`[SmartAgent] No learned patterns, using defaults`);
      return defaultParams;
    }

    // Выбираем лучший паттерн, избегая уже использованных в предыдущих попытках
    const selectedPattern = retryCount < topPatterns.length ? 
      topPatterns[retryCount] : topPatterns[0];

    console.log(`[SmartAgent] Using best pattern (score: ${selectedPattern.score.toFixed(2)}, success: ${selectedPattern.successes}/${selectedPattern.trials})`);
    
    // Объединяем параметры паттерна с параметрами по умолчанию
    return Object.assign({}, defaultParams, selectedPattern.params);
  }

  /**
   * Создает подпись контекста для группировки схожих ситуаций
   */
  private createContextSignature(actionName: string, context: SmartAgentContext): string {
    const key = [
      actionName,
      context.platform || 'unknown',
      context.campaignId ? 'with_campaign' : 'no_campaign',
      context.userId ? 'with_user' : 'no_user'
    ].join('_');

    return key;
  }

  /**
   * Классифицирует ошибку для обучения
   */
  private classifyError(error: any): BotErrorCode {
    const message = error?.message?.toLowerCase() || '';
    const response = error?.response;

    if (message.includes('auth') || message.includes('unauthorized') || response?.status === 401) {
      return 'AUTH_MISSING';
    }
    
    if (message.includes('rate limit') || response?.status === 429) {
      return 'RATE_LIMIT';
    }
    
    if (message.includes('validation') || message.includes('invalid') || response?.status === 400) {
      return 'VALIDATION';
    }
    
    if (message.includes('network') || message.includes('timeout') || !response) {
      return 'NETWORK';
    }
    
    if (response?.status >= 500) {
      return 'PLATFORM_DOWN';
    }

    return 'UNKNOWN';
  }

  /**
   * Очищает сообщение об ошибке от чувствительной информации
   */
  private sanitizeErrorMessage(error: any): string {
    let message = error?.message || error?.toString() || 'Unknown error';
    
    // Убираем токены и ключи
    message = message.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]');
    message = message.replace(/token[=:]\s*[A-Za-z0-9\-._~+/]+=*/gi, 'token=[REDACTED]');
    message = message.replace(/key[=:]\s*[A-Za-z0-9\-._~+/]+=*/gi, 'key=[REDACTED]');
    message = message.replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]');
    
    // Ограничиваем длину
    if (message.length > 500) {
      message = message.substring(0, 500) + '...';
    }
    
    return message;
  }

  /**
   * Определяет, стоит ли повторить операцию
   */
  private shouldRetry(errorCode: BotErrorCode, retryCount: number): boolean {
    if (retryCount >= this.options.maxRetries) {
      return false;
    }

    // Не повторяем для некоторых типов ошибок
    switch (errorCode) {
      case 'AUTH_MISSING':
        return false; // Нет смысла повторять без исправления авторизации
      case 'VALIDATION':
        return retryCount === 0; // Один раз можно попробовать с другими параметрами
      case 'RATE_LIMIT':
      case 'NETWORK':
      case 'PLATFORM_DOWN':
        return true; // Эти ошибки могут быть временными
      default:
        return true;
    }
  }

  /**
   * Вычисляет задержку перед повтором
   */
  private calculateRetryDelay(errorCode: BotErrorCode, retryCount: number): number {
    let baseDelay = this.options.retryDelayMs;

    switch (errorCode) {
      case 'RATE_LIMIT':
        baseDelay *= (2 ** retryCount); // Exponential backoff для rate limit
        break;
      case 'NETWORK':
        baseDelay *= (1 + retryCount * 0.5); // Умеренное увеличение для сетевых ошибок
        break;
      default:
        baseDelay *= (1 + retryCount * 0.2);
    }

    // Добавляем небольшую случайность для избежания thundering herd
    const jitter = Math.random() * 0.3 * baseDelay;
    return Math.min(baseDelay + jitter, 30000); // Максимум 30 секунд
  }

  /**
   * Вычисляет награду за операцию
   */
  private calculateReward(outcomeType: BotOutcomeType, durationMs: number, retryCount: number): number {
    if (outcomeType === 'fail') {
      return 0;
    }

    let reward = 1; // Базовая награда за успех

    // Штрафуем за долгое выполнение
    if (durationMs > 10000) { // Более 10 секунд
      reward *= 0.8;
    } else if (durationMs < 1000) { // Менее 1 секунды
      reward *= 1.2; // Поощряем быстрое выполнение
    }

    // Штрафуем за необходимость повторов
    if (retryCount > 0) {
      reward *= Math.pow(0.8, retryCount);
    }

    return Math.max(0, Math.min(2, reward)); // Ограничиваем от 0 до 2
  }

  /**
   * Ждет указанное количество миллисекунд
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Получает статистику обучения
   */
  async getStats(): Promise<{
    totalExperiences: number;
    totalPatterns: number;
    successRate: number;
    topActions: Array<{ actionName: string; successes: number; failures: number; successRate: number }>;
  }> {
    const experiences = await storage.getBotExperiences();
    
    // Подсчитываем уникальные паттерны по действиям
    const uniqueActions = Array.from(new Set(experiences.map(exp => exp.actionName)));
    let totalPatterns = 0;
    
    // Получаем паттерны для каждого уникального действия
    for (const actionName of uniqueActions) {
      const patterns = await storage.getTopBotPatterns(actionName, undefined, 1000);
      totalPatterns += patterns.length;
    }
    
    const totalExperiences = experiences.length;
    const successes = experiences.filter(exp => exp.outcomeType === 'success').length;
    const successRate = totalExperiences > 0 ? successes / totalExperiences : 0;

    // Группируем по действиям
    const actionStats: Record<string, { successes: number; failures: number }> = {};
    
    experiences.forEach(exp => {
      if (!actionStats[exp.actionName]) {
        actionStats[exp.actionName] = { successes: 0, failures: 0 };
      }
      
      if (exp.outcomeType === 'success') {
        actionStats[exp.actionName].successes++;
      } else {
        actionStats[exp.actionName].failures++;
      }
    });

    const topActions = Object.entries(actionStats)
      .map(([actionName, stats]) => ({
        actionName,
        successes: stats.successes,
        failures: stats.failures,
        successRate: stats.successes / (stats.successes + stats.failures)
      }))
      .sort((a, b) => (b.successes + b.failures) - (a.successes + a.failures))
      .slice(0, 10);

    return {
      totalExperiences,
      totalPatterns,
      successRate,
      topActions
    };
  }
}

// Создаем глобальный экземпляр SmartAgent
export const smartAgent = new SmartAgent({
  epsilon: 0.1, // 10% exploration
  maxRetries: 2,
  retryDelayMs: 1000,
  enableLearning: true
});