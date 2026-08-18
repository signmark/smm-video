import axios from 'axios';
import { log, logEvent } from '../utils/logger';
import { storage } from '../storage';
import { directusCrud } from './directus-crud';
import { publicationLockManager } from './publication-lock-manager';
import { publicationTracker } from './publication-tracking';
import { getN8nUrl } from '../utils/n8n-utils';
import { aiService } from './ai-service';
import { getContentAggregateTimes, isSameStoredInstant, parseStoredInstant, resolvePublishFinalization } from '@shared/schedule-time';
import { invalidateContentCache } from '../utils/content-cache';
import {
  resolveStuckContent,
  isPermanentPublishError,
  getStaleDays,
} from './publication-terminal-state';
import { notifyPublished } from './notification-bus';
import { recordPublished, wasPublished, forget, readJournal } from './publish-fallback-journal';
import { resolvePublishingToken } from './publishing-token';
import { stripMarkdown, markdownToTelegramHtml } from '../utils/strip-markdown';

// Платформо-специфичные правила адаптации контента
const PLATFORM_STYLE: Record<string, string> = {
  telegram: `
ПЛАТФОРМА: Telegram-канал
- Максимум 4096 символов
- Поддерживает эмодзи, переносы строк, ссылки
- Хэштеги работают, но использовать умеренно (2–4)
- Можно оставлять структуру «абзац + пустая строка»
- НЕ используй Markdown-разметку (**жирный**, *курсив*) — вместо этого используй HTML: <b>жирный</b>, <i>курсив</i>
- Telegram поддерживает HTML-теги: <b>, <i>, <u>, <s>, <code>, <a href="...">
- CTA с ссылкой или кнопкой уместен в конце`,

  vk: `
ПЛАТФОРМА: ВКонтакте
- Максимум 15 000 символов
- Хэштеги через # работают, 3–7 шт.
- Можно использовать эмодзи умеренно
- Разбивай на абзацы, пустые строки уместны
- Не используй Markdown-разметку (** * __ _) — ВКонтакте её не рендерит
- CTA с призывом прокомментировать или поделиться`,

  instagram: `
ПЛАТФОРМА: Instagram
- Максимум 2200 символов в caption
- Хэштеги внизу поста, 5–15 штук, отделить переносом строк
- Первые 125 символов видны без раскрытия — сделай зацепку сразу
- Эмодзи обязательны, придают визуальный ритм
- Никаких URL в тексте (в Instagram они не кликабельны в caption)
- Не используй Markdown-разметку (** * __ _) — Instagram её не поддерживает
- CTA: "👉 Ссылка в шапке профиля"`,

  facebook: `
ПЛАТФОРМА: Facebook
- Оптимально 40–80 слов; максимум 63 206 символов
- Хэштеги работают, но 1–3 максимум
- Эмодзи уместны, не перебарщивай
- Уместен более «официальный» тон по сравнению с Instagram
- Не используй Markdown-разметку (** * __ _) — Facebook её не рендерит
- CTA с вопросом, побуждающим к комментированию`,

  threads: `
ПЛАТФОРМА: Threads
- Максимум 500 символов
- Очень короткий, лаконичный текст
- 1–2 хэштега максимум или вообще без хэштегов
- Разговорный стиль, как твит
- Не используй Markdown-разметку (** * __ _) — Threads её не поддерживает
- CTA в одной фразе`,

  youtube: `
ПЛАТФОРМА: YouTube (описание к видео)
- Оптимально 200–500 слов в описании
- Первые 150 символов видны без раскрытия — важная зацепка
- Хэштеги: 3–5 штук в самом конце описания
- Структура: зацепка → о чём видео → ключевые тезисы → CTA (подписка, лайк)
- Не используй Markdown-разметку (** * __ _) — YouTube её не рендерит в описании
- Временные метки (таймкоды) уместны если есть главы`
};

/**
 * AI-120: решение «пора ли публиковать» — чистая функция, без сети и блокировок.
 *
 * Раньше эта проверка стояла ПОСЛЕ захвата блокировки (уровень 4), поэтому на
 * каждом цикле планировщик брал и тут же отпускал блокировку для каждого
 * будущего поста: три обращения к Directus на платформу на цикл впустую.
 * Дублей это не давало, но создавало постоянный фон запросов и шума в логе и
 * прятало настоящие конфликты блокировок среди служебных.
 *
 * Порядок сравнения сохранён прежний: приоритет у времени платформы, иначе
 * общее время контента, иначе публикуем немедленно. Неразбираемое время даёт
 * due=false — как и раньше, когда сравнение с Invalid Date всегда ложно.
 */
export type PublishTimeSource = 'platform' | 'content' | 'immediate';

export interface PublishTimeDecision {
  due: boolean;
  source: PublishTimeSource;
  at: Date | null;
}

export function decidePublishTime(
  platformData: { scheduledAt?: string | null; scheduled_at?: string | null } | null | undefined,
  contentScheduledAt: string | null | undefined,
  now: Date,
): PublishTimeDecision {
  const rawPlatform = platformData?.scheduledAt || platformData?.scheduled_at;
  if (rawPlatform) {
    const at = parseStoredInstant(rawPlatform) ?? new Date(NaN);
    return { due: at.getTime() <= now.getTime(), source: 'platform', at };
  }

  if (contentScheduledAt) {
    const at = parseStoredInstant(contentScheduledAt) ?? new Date(NaN);
    return { due: at.getTime() <= now.getTime(), source: 'content', at };
  }

  return { due: true, source: 'immediate', at: null };
}

/**
 * Безопасный текст времени для лога: toISOString() на Invalid Date бросает
 * RangeError, а ронять цикл планировщика из-за строки лога недопустимо.
 */
export function formatPublishInstant(at: Date | null): string {
  if (!at) return 'не задано';
  return Number.isNaN(at.getTime()) ? 'не разобрано' : at.toISOString();
}

/**
 * AI-65, этап 4: доменные события публикации.
 *
 * ЗАЧЕМ. По этим именам потом строятся оповещения: «публикация упала чаще N раз
 * за четверть часа», «крон замолчал». Искать по тексту сообщения нельзя — текст
 * переписывают при первой правке формулировки, и все сохранённые запросы молча
 * перестают находить.
 *
 * ГДЕ. Событие ставится в единственной точке записи статуса площадки
 * (mergeAndSavePlatformStatus), а не в каждом из десятка методов публикации.
 * Иначе новая площадка появится без события, и никто этого не заметит.
 */
export type PublishEvent = 'publish.succeeded' | 'publish.failed' | 'publish.record_failed';

/**
 * Событие по итоговому статусу площадки. Промежуточные статусы события не дают:
 * `publishing` и `pending` — это состояние в процессе, а не исход.
 */
export function publishOutcomeEvent(status: unknown): PublishEvent | null {
  if (status === 'published') return 'publish.succeeded';
  if (status === 'failed') return 'publish.failed';
  // Пост ушёл на площадку, но записать это в базу не удалось: самый опасный
  // исход из всех, потому что снаружи выглядит как неопубликованный.
  if (status === 'publish_succeeded_record_failed') return 'publish.record_failed';
  return null;
}

/**
 * Стабильная машинная причина отказа из текста ошибки площадки.
 *
 * Сам текст в событие не кладём: он приходит от внешней системы и содержит и
 * идентификаторы, и куски запроса. Но по нему можно один раз определить род
 * неприятности — а род как раз и нужен для оповещений.
 */
export function classifyPublishFailure(error: unknown): string {
  const text = typeof error === 'string' ? error.toLowerCase() : '';
  if (!text) return 'unknown';

  if (text.includes('invalid access token') || text.includes('token expired') ||
      text.includes('authexpired') || text.includes('срок действия')) return 'token_expired';
  if (text.includes('does not have permission') || text.includes('forbidden') ||
      text.includes('нет прав')) return 'forbidden';
  if (text.includes('not found') || text.includes('chat not found') ||
      text.includes('не найден')) return 'not_found';
  if (text.includes('quota') || text.includes('rate limit') ||
      text.includes('too many requests') || text.includes('лимит')) return 'rate_limit';
  if (text.includes('временно отключ') || text.includes('не поддерживает')) return 'platform_disabled';
  if (text.includes('timeout') || text.includes('etimedout') ||
      text.includes('econnaborted')) return 'timeout';
  return 'platform_error';
}

/**
 * Исправленный класс для планирования и выполнения автоматической публикации контента
 * с поддержкой индивидуального времени публикации для каждой платформы через N8N
 */
export class PublishScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 30000; // проверяем каждые 30 секунд
  private isProcessing = false;
  private adminTokenCache: string | null = null;
  private adminTokenTimestamp: number = 0;
  private tokenExpirationMs = 30 * 60 * 1000; // 30 минут
  private tickCount = 0;
  private heartbeatEveryNTicks = 20; // console.log каждые 20 тиков = каждые ~10 минут
  
  // Кэш для предотвращения повторной публикации (ЛИМИТИРОВАННЫЙ)
  private processedContentCache = new Map<string, Set<string>>(); // contentId -> Set<platform>
  /**
   * AI-102: когда в последний раз печатали сохранённую ошибку terminal-записи.
   *
   * Запись в статусе `failed` планировщик не отправляет — он её только
   * пропускает. Но лог с её ошибкой выводился на КАЖДОМ проходе, то есть раз в
   * 30 секунд, бесконечно. В утреннем инциденте это забило журнал текстом
   * ошибок, которые никуда не уходят, и увело диагностику в сторону.
   *
   * Совсем убирать лог нельзя: по нему видно, что записи висят. Поэтому не
   * чаще одного раза в час на связку контент+платформа+текст ошибки — смена
   * текста ошибки печатается сразу.
   */
  private terminalErrorLoggedAt = new Map<string, number>();
  private terminalErrorCooldownMs = 60 * 60 * 1000;
  private maxCacheSize = 1000; // Максимум 1000 элементов в кэше
  private cacheCleanupInterval = 2 * 60 * 60 * 1000; // очищаем кэш каждые 2 часа
  private lastCacheCleanup = Date.now();

  /**
   * Очищает кэш обработанного контента с ЛИМИТОМ РАЗМЕРА
   */
  private cleanupCache() {
    const now = Date.now();
    
    // Принудительная очистка при превышении лимита размера
    if (this.processedContentCache.size > this.maxCacheSize) {
      // Удаляем 50% старых записей 
      const entries = Array.from(this.processedContentCache.entries());
      const toDelete = entries.slice(0, Math.floor(entries.length / 2));
      
      for (const [key] of toDelete) {
        this.processedContentCache.delete(key);
      }
      
      log(`🚨 MEMORY: Кэш урезан до ${this.processedContentCache.size} элементов (было ${entries.length})`, 'scheduler');
    }
    
    // Периодическая очистка по времени
    if (now - this.lastCacheCleanup > this.cacheCleanupInterval) {
      const oldSize = this.processedContentCache.size;
      this.processedContentCache.clear();
      this.lastCacheCleanup = now;
      log(`🛡️ Кэш очищен по расписанию (размер был: ${oldSize})`, 'scheduler');
    }
  }

  /**
   * Принудительно очищает кэш для конкретного контента
   */
  public clearContentCache(contentId: string) {
    this.processedContentCache.delete(contentId);
    log(`Кэш очищен для контента ${contentId}`, 'scheduler');
  }

  /**
   * Снимает блокировку кэша для конкретной платформы (используется после retry-перепланировки)
   */
  private releasePlatformCache(contentId: string, platform: string) {
    const platformSet = this.processedContentCache.get(contentId);
    if (platformSet) {
      platformSet.delete(platform);
      log(`Кэш снят для ${contentId}:${platform}`, 'scheduler', 'debug');
    }
  }

  /**
   * Проверяет, была ли уже обработана публикация для данной платформы
   */
  private isAlreadyProcessed(contentId: string, platform: string): boolean {
    const platformSet = this.processedContentCache.get(contentId);
    return platformSet ? platformSet.has(platform) : false;
  }

  /**
   * Отмечает контент как обработанный для данной платформы
   */
  private markAsProcessed(contentId: string, platform: string) {
    let platformSet = this.processedContentCache.get(contentId);
    if (!platformSet) {
      platformSet = new Set();
      this.processedContentCache.set(contentId, platformSet);
    }
    platformSet.add(platform);
  }

  /**
   * Запускает планировщик публикаций
   */
  start() {
    if (this.isRunning) {
      log('⚠️ Планировщик уже запущен, пропускаем повторный запуск', 'scheduler');
      return;
    }

    this.isRunning = true;
    log('✅ Запуск планировщика публикаций с поддержкой индивидуального времени платформ', 'scheduler');
    
    // Сразу выполняем первую проверку
    this.checkScheduledContent();
    
    // Устанавливаем интервал для регулярной проверки
    this.intervalId = setInterval(() => {
      this.checkScheduledContent();
    }, this.checkIntervalMs);
    
    log(`✅ Планировщик запущен с интервалом ${this.checkIntervalMs}мс`, 'scheduler');
  }

  /**
   * Останавливает планировщик публикаций
   */
  stop() {
    if (!this.isRunning || !this.intervalId) {
      log('Планировщик публикаций не запущен', 'scheduler');
      return;
    }

    log('Остановка планировщика публикаций', 'scheduler');
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.isRunning = false;
    this.isProcessing = false;
  }

  /**
   * Полная очистка всех данных и остановка фоновых процессов
   */
  shutdown() {
    this.stop();
    
    // Очищаем все кэши
    this.processedContentCache.clear();
    this.adminTokenCache = null;
    
    log('🔴 PublishScheduler: Полная очистка памяти выполнена', 'scheduler');
  }





  /**
   * Проверяет и публикует запланированный контент с учетом индивидуального времени платформ
   * @param specificContentId Если указан, обрабатывает только этот контент
   */
  async checkScheduledContent(specificContentId?: string) {
    try {
      if (this.isProcessing) {
        return;
      }
      
      this.isProcessing = true;
      this.tickCount++;
      const cycleStartedAt = Date.now();
      
      // Heartbeat каждые ~10 минут — видно в production-логах
      if (this.tickCount % this.heartbeatEveryNTicks === 1) {
        console.log(`[SCHEDULER] ❤️ heartbeat tick=${this.tickCount} at ${new Date().toISOString()}`);
      }
      
      // Очищаем кэш при необходимости
      this.cleanupCache();
      
      // directusCrud сам обрабатывает токены, проверяем только наличие Directus URL
      const directusUrl = process.env.DIRECTUS_URL;
      if (!directusUrl) {
        log(`❌ DIRECTUS_URL not configured`, 'scheduler', 'error');
        this.isProcessing = false;
        return;
      }
      log(`🔑 Using directusCrud with auto-token management`, 'scheduler', 'debug');

      const currentTime = new Date();
      
      // Получаем контент со статусами 'scheduled', 'partial' и 'pending' для обработки
      let allContent: any[] = [];
      
      try {
        const filter: any = {
          status: {
            _in: ['scheduled', 'partial', 'pending', 'partially_published']
          }
        };
        log(`🔍 Fetching content with statuses: scheduled, partial, pending, partially_published`, 'scheduler', 'debug');

        // Если указан конкретный ID, добавляем его в фильтр
        if (specificContentId) {
          filter.id = { _eq: specificContentId };
        }

        // Используем directusCrud с админским токеном
        // Сортируем по scheduled_at ASC — сначала самые старые (давно просроченные не будут вытеснены новыми)
        allContent = await directusCrud.list('campaign_content', {
          filter,
          limit: specificContentId ? 1 : 500,
          sort: ['scheduled_at'],
          useAdminToken: true
        });
        
        if (allContent.length === 0) {
          log(`📭 No content found - check if content has status scheduled/partial/pending`, 'scheduler', 'debug');
          // AI-65. Прогон, не нашедший работы, — тоже завершённый прогон. Если
          // молчать здесь, оповещение «крон замолчал» будет срабатывать каждый
          // раз, когда на доске просто нет запланированного контента, и его
          // очень быстро отключат — а вместе с ним и настоящий сигнал.
          logEvent(
            'cron.finished',
            { operation: 'publish-scheduler', count: 0, durationMs: Date.now() - cycleStartedAt },
            'info',
            'scheduler',
            'Цикл планировщика: запланированного контента нет',
          );
          this.isProcessing = false;
          return;
        }

        log(`📊 Found ${allContent.length} content items with statuses: scheduled, partial, pending`, 'scheduler', 'debug');

        // Логируем найденный контент
        for (const c of allContent) {
          log(`📋 Content ${c.id}: status=${c.status}, scheduled_at=${c.scheduled_at || 'NULL'}`, 'scheduler', 'debug');
        }

        // AI-85: сначала догоняем записи публикаций, которые не сохранились
        // из-за недоступности базы, иначе этот же цикл сочтёт их неопубликованными.
        await this.reconcilePublishJournal();

        let processedCount = 0;
        let publishedCount = 0;
        const publicationJobs: Array<{ content: any; platforms: string[] }> = [];

        // Обрабатываем каждый контент для определения неопубликованных платформ
        for (const content of allContent) {
          processedCount++;

          // Задача 108: запись, у которой не осталось незавершённых площадок,
          // обязана принять окончательный статус — иначе она висит «в работе»
          // годами. Второй повод закрыть — время выхода прошло давно: такой пост
          // отправлять живым подписчикам нельзя.
          if (await this.finalizeStuckContent(content, currentTime)) {
            continue;
          }

          // Получаем данные платформ
          const platformsData = content.social_platforms || content.socialPlatforms;
          if (!platformsData) {
            log(`⏭️ Skipping ${content.id}: no social_platforms data`, 'scheduler', 'debug');
            // Pending без платформ и без даты — зависший элемент, откатываем в draft
            if (content.status === 'pending' && !content.scheduled_at) {
              log(`🔄 Auto-reverting stuck pending item ${content.id} to draft (null platforms, no schedule)`, 'scheduler');
              try {
                await directusCrud.update('campaign_content', content.id, { status: 'draft' }, { useAdminToken: true });
              } catch (revertErr: any) {
                if (revertErr.message?.includes('403')) {
                  log(`⚠️ Skipping revert ${content.id} — no write permission (check DIRECTUS_STATIC_TOKEN)`, 'scheduler');
                } else {
                  log(`⚠️ Could not revert ${content.id}: ${revertErr.message}`, 'scheduler');
                }
              }
            }
            continue;
          }

          let platforms = platformsData;
          if (typeof platforms === 'string') {
            try {
              platforms = JSON.parse(platforms);
            } catch (e) {
              log(`⏭️ Skipping ${content.id}: failed to parse social_platforms`, 'scheduler', 'debug');
              continue;
            }
          }
          
          // Проверяем что platforms не пустой объект
          const platformNames = Object.keys(platforms);
          if (platformNames.length === 0) {
            log(`⏭️ Skipping ${content.id}: empty social_platforms {}`, 'scheduler', 'debug');
            // Если запись застряла в pending без дат и платформ — возвращаем в draft
            if (content.status === 'pending' && !content.scheduled_at) {
              log(`🔄 Auto-reverting stuck pending item ${content.id} to draft (no platforms, no schedule)`, 'scheduler');
              try {
                await directusCrud.update('campaign_content', content.id, { status: 'draft' }, { useAdminToken: true });
              } catch (revertErr: any) {
                if (revertErr.message?.includes('403')) {
                  log(`⚠️ Skipping revert ${content.id} — no write permission (check DIRECTUS_STATIC_TOKEN)`, 'scheduler');
                } else {
                  log(`⚠️ Could not revert ${content.id}: ${revertErr.message}`, 'scheduler');
                }
              }
            }
            continue;
          }
          
          log(`🔎 Processing ${content.id}: platforms=${platformNames.join(', ')}`, 'scheduler', 'debug');
          
          // Определяем платформы готовые к публикации с учетом времени
          const readyPlatforms = [];
          // Анализируем платформы (детали только в debug)
          const { isPlatformCompatible } = await import('../utils/content-type-platform-map');
          const contentTypeForFilter = content.content_type as string | undefined;

          for (const [platformName, platformData] of Object.entries(platforms)) {
            // Молча пропускаем несовместимые платформы (например, YouTube для text-image)
            if (!isPlatformCompatible(platformName, contentTypeForFilter)) continue;

            const data = platformData as any;
            log(`  📍 ${content.id}:${platformName} status=${data.status}, postUrl=${data.postUrl ? 'SET' : 'EMPTY'}`, 'scheduler', 'debug');
            
            // Проверяем postUrl - пропускаем уже опубликованные
            if (data.postUrl && data.postUrl.trim() !== '') {
              log(`  ⏭️ ${content.id}:${platformName} SKIP - already has postUrl`, 'scheduler', 'debug');
              continue;
            }
            
            // Пропускаем уже опубликованные платформы
            if (data.status === 'published') {
              log(`  ⏭️ ${content.id}:${platformName} SKIP - status=published`, 'scheduler', 'debug');
              continue;
            }

            // Пропускаем платформы в процессе публикации через N8N
            // Но если N8N обрабатывает дольше 30 минут без postUrl — считаем зависшим и сбрасываем
            if (data.status === 'publishing') {
              const publishingAt = data.publishingAt || data.updatedAt
                ? new Date(data.publishingAt || data.updatedAt)
                : null;
              const minutesSince = publishingAt
                ? (Date.now() - publishingAt.getTime()) / 60000
                : 999;
              if (minutesSince < 30) {
                log(`  ⏭️ ${content.id}:${platformName} SKIP - status=publishing (N8N processing, ${Math.round(minutesSince)}min ago)`, 'scheduler', 'debug');
                continue;
              }
              // Зависло — сбрасываем обратно в pending чтобы планировщик мог повторить
              console.error(`[SCHEDULER] ⚠️ ${content.id}:${platformName} stuck publishing for ${Math.round(minutesSince)}min — resetting to pending`);
              try {
                const freshList = await directusCrud.list('campaign_content', {
                  filter: { id: { _eq: content.id } },
                  limit: 1,
                  useAdminToken: true
                });
                const freshContent = freshList?.[0];
                const currentPlatforms = freshContent?.social_platforms || content.social_platforms || {};
                const existingData = currentPlatforms[platformName] || {};
                await directusCrud.update('campaign_content', content.id, {
                  social_platforms: {
                    ...currentPlatforms,
                    [platformName]: { ...existingData, status: 'pending', updatedAt: new Date().toISOString() }
                  }
                }, { useAdminToken: true });
                data.status = 'pending'; // обновляем локально чтобы продолжить обработку
              } catch (resetErr: any) {
                console.error(`[SCHEDULER] Failed to reset publishing status: ${resetErr.message}`);
                continue;
              }
            }
            
            // Пропускаем платформы с failed статусом (логируем только критические)
            if (data.status === 'failed') {
              log(`  ⏭️ ${content.id}:${platformName} SKIP - status=failed`, 'scheduler', 'debug');
              // Логируем только критические ошибки конфигурации и не чаще
              // раза в час на одну и ту же запись (AI-102).
              if (data.error && (data.error.includes('CRITICAL') || data.error.includes('not found'))) {
                if (this.shouldLogTerminalError(content.id, platformName, data.error)) {
                  log(`❌ ${platformName} ${content.id}: ${data.error}`, 'scheduler');
                }
              }
              continue;
            }

            // SM-15 / AI-85: пропускаем платформы с publish_succeeded_record_failed.
            // Пост реально опубликован (пост висит на платформе), но в БД не зафиксирован.
            // Планировщик НЕ должен ретрить — иначе получим дубль на платформе.
            // Защита работает только если маркер сохранился; если нет — защиту даёт
            // Task B (сверка с платформой перед повтором).
            if (data.status === 'publish_succeeded_record_failed') {
              log(`  ⏭️ ${content.id}:${platformName} SKIP - status=publish_succeeded_record_failed (post already on platform, do not re-send)`, 'scheduler', 'info');
              continue;
            }
            
            // Пропускаем критические конфигурационные ошибки
            if (data.error && (
              data.error.includes('CRITICAL') ||
              data.error.includes('не найдены в кампании') ||
              data.error.includes('not found in campaign') ||
              data.error.includes('Invalid access token') ||
              data.error.includes('Application does not have permission') ||
              data.error.includes('токен недействителен') ||
              data.error.includes('токен истек') ||
              data.error.includes('настройки платформы не настроены') ||
              data.error.includes('platform settings not configured')
            )) {
              continue; // Молча пропускаем конфигурационные ошибки
            }

            // ⏰ AI-120: время проверяем ДО уровней защиты и до блокировки.
            // Пост, чьё время ещё не наступило, не должен занимать блокировку:
            // раньше он захватывал её и тут же отпускал на каждом цикле.
            const timeDecision = decidePublishTime(data, content.scheduled_at, currentTime);
            if (!timeDecision.due) {
              const waitFor = timeDecision.source === 'platform' ? 'своего времени' : 'общего времени контента';
              log(`Планировщик: Платформа ${platformName} ждет ${waitFor} - ${formatPublishInstant(timeDecision.at)} > ${currentTime.toISOString()}`, 'scheduler', 'debug');
              continue;
            }

            // 📊 ДЕТАЛЬНАЯ ПРОВЕРКА ЗАЩИТЫ
            log(`  📊 ${content.id}:${platformName} - checking protection levels`, 'scheduler', 'debug');
            
            // 🛡️ УРОВЕНЬ 1: Локальный кэш планировщика
            const level1Check = this.isAlreadyProcessed(content.id, platformName);
            if (level1Check) {
              log(`  ⛔ ${content.id}:${platformName} BLOCKED by Level 1 (local cache)`, 'scheduler', 'debug');
              continue;
            }
            
            // 🛡️ УРОВЕНЬ 2: Publication Tracker (база данных)
            const canPublishFromDB = await publicationTracker.canPublish(content.id, platformName);
            if (!canPublishFromDB) {
              log(`  ⛔ ${content.id}:${platformName} BLOCKED by Level 2 (publication tracker)`, 'scheduler', 'debug');
              continue;
            }
            
            // ... (YouTube quota logic unchanged)
            
            // 🛡️ УРОВЕНЬ 3: Lock Manager блокировки
            const level3Check = await publicationLockManager.isLocked(content.id, platformName);
            if (level3Check) {
              log(`  ⛔ ${content.id}:${platformName} BLOCKED by Level 3 (lock manager)`, 'scheduler', 'debug');
              continue;
            }

            // 🛡️ УРОВЕНЬ 4: Получаем блокировку Lock Manager для планировщика
            const lockAcquired = await publicationLockManager.acquireLock(content.id, platformName);
            if (!lockAcquired) {
              log(`  ⛔ ${content.id}:${platformName} BLOCKED by Level 4 (cannot acquire lock)`, 'scheduler', 'debug');
              continue;
            }
            log(`  ✅ ${content.id}:${platformName} - all protection levels passed`, 'scheduler', 'debug');

            // Умная обработка YouTube quota_exceeded - проверяем, не обновились ли квоты
            if (platformName === 'youtube' && data.status === 'quota_exceeded') {
              // ... (YouTube quota logic unchanged)
              const quotaExceededTime = data.updatedAt ? new Date(data.updatedAt) : null;
              let shouldResetQuota = false;
              
              if (quotaExceededTime) {
                const nowPT = new Date();
                const ptOffset = -8 * 60;
                const ptTime = new Date(nowPT.getTime() + ptOffset * 60000);
                const quotaPTTime = new Date(quotaExceededTime.getTime() + ptOffset * 60000);
                const daysDiff = Math.floor((ptTime.getTime() - quotaPTTime.getTime()) / (24 * 60 * 60 * 1000));
                
                if (daysDiff >= 1) {
                  shouldResetQuota = true;
                  log(`Планировщик: YouTube квоты обновились, сбрасываем quota_exceeded для контента ${content.id}`, 'scheduler');
                }
              } else {
                shouldResetQuota = true;
                log(`Планировщик: Сбрасываем старый quota_exceeded статус без даты для контента ${content.id}`, 'scheduler');
              }
              
              if (!shouldResetQuota) {
                const errorMessage = data.error || '';
                const errorType = errorMessage.includes('exceeded the number of videos') ? 
                  'достигнут дневной лимит загрузок видео' : 'превышена квота API';
                
                log(`Планировщик: Пропускаем YouTube ${content.id} - ${errorType} (квоты еще не обновились)`, 'scheduler');
                // AI-120: блокировка уже взята уровнем 4 — отпускаем, иначе она
                // висит до истечения срока и мешает следующему циклу.
                await publicationLockManager.releaseLock(content.id, platformName);
                continue;
              } else {
                if (data.postUrl) {
                  log(`🛡️ КРИТИЧЕСКАЯ ЗАЩИТА: YouTube контент ${content.id} УЖЕ ОПУБЛИКОВАН (${data.postUrl}), НЕ СБРАСЫВАЕМ quota_exceeded!`, 'scheduler');
                  await publicationLockManager.releaseLock(content.id, platformName);
                  continue;
                }
                log(`Планировщик: Сбрасываем quota_exceeded статус для YouTube контента ${content.id}`, 'scheduler');
              }
            }

            // Время уже проверено выше (AI-120), сюда доходит только то, что пора публиковать.
            if (timeDecision.source === 'immediate') {
              console.log(`[SCHEDULER] 🚀 IMMEDIATE ${content.id}:${platformName} — no scheduled time set`);
            } else {
              const label = timeDecision.source === 'platform' ? 'time' : 'content time';
              console.log(`[SCHEDULER] ✅ READY ${content.id}:${platformName} — ${label} ${formatPublishInstant(timeDecision.at)} <= now ${currentTime.toISOString()}`);
            }

            // 🛡️ УРОВЕНЬ 5 и 6: Отмечаем в кэше планировщика и Publication Tracker
            this.markAsProcessed(content.id, platformName);
            publicationTracker.markAsProcessed(content.id, platformName);
            readyPlatforms.push(platformName);
            log(`🛡️ Планировщик: Платформа ${platformName} защищена от дублирования и добавлена в очередь для ${content.id}`, 'scheduler', 'debug');
          }

          if (readyPlatforms.length > 0) {
            console.log(`[SCHEDULER] 🚀 PUBLISHING ${content.id} → platforms: ${readyPlatforms.join(', ')}`);
            publicationJobs.push({ content, platforms: readyPlatforms });
          }
          // Тихо пропускаем контент без готовых платформ
        }

        // Отправляем итоговое уведомление только если что-то опубликовано
        // Posts sharing the same scheduled time must start in the same scheduler batch.
        // Limit concurrency so a slow first post cannot delay the rest without flooding APIs.
        const maxConcurrentPublications = 5;
        let nextPublicationJob = 0;
        const runPublicationWorker = async () => {
          while (nextPublicationJob < publicationJobs.length) {
            const jobIndex = nextPublicationJob++;
            const { content, platforms } = publicationJobs[jobIndex];
            try {
              await this.publishContentToPlatforms(content, platforms);
              publishedCount++;
            } catch (error: any) {
              log(`Publication batch error for ${content.id}: ${error.message}`, 'scheduler', 'error');

              // Do not leave an unexpectedly failed post blocked until cache timeout.
              // Persisted postUrl/status still protects a publication that already completed.
              for (const platform of platforms) {
                this.releasePlatformCache(content.id, platform);
                publicationTracker.releasePublication(content.id, platform);
              }
              await Promise.allSettled(
                platforms.map(platform => publicationLockManager.releaseLock(content.id, platform))
              );
            }
          }
        };

        await Promise.all(
          Array.from(
            { length: Math.min(maxConcurrentPublications, publicationJobs.length) },
            () => runPublicationWorker()
          )
        );

        // AI-65. Итог цикла нужен не ради статистики: отсутствие этой строки
        // дольше ожидаемого интервала — единственный признак тихо умершего
        // крона. Ровно так когда-то незаметно умер VK-мониторинг.
        logEvent(
          'cron.finished',
          { operation: 'publish-scheduler', count: publishedCount, durationMs: Date.now() - cycleStartedAt },
          'info',
          'scheduler',
          `Цикл планировщика: обработано ${processedCount}, отправлено на публикацию ${publishedCount}`,
        );

        if (publishedCount > 0) {
          try {
            const { broadcastNotification } = await import('./notification-bus');
            broadcastNotification('scheduler_processing_complete', {
              processedCount,
              publishedCount,
              message: `Контент успешно отправлен на публикацию`
            });
          } catch (error) {
            // Игнорируем ошибки уведомлений
          }
        }
        
      } catch (error: any) {
        log(`❌ API Error: ${error.response?.status || 'N/A'} - ${error.message}`, 'scheduler', 'error');
        // Тихо обрабатываем ошибки аутентификации
        if (error.response?.status === 401) {
          log(`🔐 401 - Token expired, clearing cache...`, 'scheduler', 'warn');
          // Сбрасываем кэш токена и получаем новый
          try {
            const { adminTokenManager } = await import('./admin-token-manager');
            adminTokenManager.clearToken();
          } catch (clearError: any) {
            // AI-65. Здесь молчать нельзя. Мы пришли сюда из 401, и весь смысл
            // ветки — сбросить протухший токен, чтобы следующий запрос взял
            // новый. Если сброс не удался, планировщик будет получать 401 в
            // каждом цикле, и снаружи это выглядит как «публикации просто не
            // идут», без единой строки о причине.
            logEvent(
              'scheduler.token_reset_failed',
              { operation: 'publish-cycle', reason: clearError?.message ? String(clearError.message) : 'unknown' },
              'error',
              'scheduler',
              'Не удалось сбросить протухший админский токен после 401',
            );
          }
          return;
        }
        
        // Логируем только критические ошибки
        if (error.response?.status !== 401 && error.response?.status !== 403) {
          log(`Планировщик: Ошибка API: ${error.message}`, 'scheduler', 'error');
        }
        return;
      }
      
    } catch (error: any) {
      logEvent(
        'cron.failed',
        { operation: 'publish-scheduler', reason: error?.code || error?.name || 'unhandled' },
        'error',
        'scheduler',
      );
      log(`Ошибка при проверке запланированных публикаций: ${error.message}`, 'scheduler', 'error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Задача 108. Приводит запись к окончательному статусу, если продолжения не будет.
   *
   * Возвращает true, когда запись закрыта и разбирать её площадки больше не нужно.
   * Решение принимает чистая `resolveStuckContent`; здесь только чтение полей,
   * запись в Directus и журнал.
   */
  private async finalizeStuckContent(content: any, now: Date): Promise<boolean> {
    let platforms: any = content.social_platforms || content.socialPlatforms;
    if (typeof platforms === 'string') {
      try {
        platforms = JSON.parse(platforms);
      } catch {
        return false; // разбитый JSON — не наш случай, ниже есть свой разбор
      }
    }

    const resolution = resolveStuckContent({
      platforms,
      currentStatus: String(content.status),
      scheduledAt: content.scheduled_at ?? content.scheduledAt ?? null,
      now,
      staleDays: getStaleDays(),
    });
    if (!resolution) return false;

    const patch: Record<string, any> = { status: resolution.contentStatus };
    if (resolution.expiredPlatforms.length > 0) {
      patch.social_platforms = resolution.platforms;
    }

    try {
      await directusCrud.update('campaign_content', content.id, patch, { useAdminToken: true });
    } catch (err: any) {
      log(`[SCHEDULER] не удалось закрыть зависшую запись ${content.id}: ${err?.message}`, 'scheduler', 'error');
      return false;
    }

    if (content.user_id) invalidateContentCache(content.user_id, content.campaign_id);

    if (resolution.reason === 'expired') {
      log(
        `[SCHEDULER] ⌛ ${content.id}: время выхода прошло, публикация отменена для ${resolution.expiredPlatforms.join(', ')} → ${resolution.contentStatus}`,
        'scheduler',
      );
    } else {
      log(
        `[SCHEDULER] ✔ ${content.id}: продолжения не будет (${resolution.reason}), статус ${content.status} → ${resolution.contentStatus}`,
        'scheduler',
      );
    }
    return true;
  }

  /**
   * Возвращает true, если ошибка связана с неверными/просроченными учётными данными —
   * такие ошибки бессмысленно ретраить, токен не починится сам.
   */
  private isAuthError(errMsg: string): boolean {
    const lower = errMsg.toLowerCase();
    return (
      // VK: error_code 5 — User authorization failed, 27 — Application auth failed
      /vk api error (5|27|15):/i.test(errMsg) ||
      lower.includes('user authorization failed') ||
      lower.includes('application authorization failed') ||
      lower.includes('invalid_token') ||
      lower.includes('invalid token') ||
      lower.includes('token expired') ||
      lower.includes('token is invalid') ||
      lower.includes('unauthorized') ||
      lower.includes('401') ||
      lower.includes('access token') && lower.includes('invalid') ||
      // Instagram / Facebook
      lower.includes('oauthinvalidtoken') ||
      lower.includes('invalid oauth') ||
      lower.includes('error_subcode: 458') ||
      lower.includes('error_subcode: 460') ||
      // Telegram
      lower.includes('unauthorized') ||
      lower.includes('bot was blocked') ||
      // Generic
      lower.includes('authentication failed') ||
      lower.includes('auth failed')
    );
  }

  /**
   * При фэйле публикации — перепланирует попытку через RETRY_DELAY_MIN или ставит окончательный failed.
   * Хранит retryCount в данных платформы. После MAX_RETRIES — failed без перепланировки.
   * Если ошибка авторизации — сразу failed, без ретраев.
   */
  private async scheduleRetryOrFail(
    content: any,
    platform: string,
    errMsg: string,
    currentPlatforms: Record<string, any>
  ): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MIN = 5;

    const existing = currentPlatforms[platform] || {};
    const retryCount = (existing.retryCount || 0) as number;
    const now = new Date();

    let platformUpdate: Record<string, any>;
    let contentStatus: string;

    // Задача 108: ретраить имеет смысл только временное. «Чат не найден»,
    // «бот заблокирован», недействительный токен и ненастроенная площадка сами
    // не пройдут — три попытки по пять минут тратятся впустую, а пользователь
    // ещё пятнадцать минут видит «публикуется» вместо причины.
    const permanentError = isPermanentPublishError(errMsg);
    const authError = this.isAuthError(errMsg);
    if (permanentError) {
      log(`[SCHEDULER] ${platform} постоянная причина для ${content.id} — немедленный failed без ретраев: ${errMsg}`, 'scheduler', 'error');
    }

    if (!permanentError && retryCount < MAX_RETRIES) {
      const nextRetry = new Date(now.getTime() + RETRY_DELAY_MIN * 60 * 1000);
      platformUpdate = {
        ...existing,
        status: 'pending',
        scheduledAt: nextRetry.toISOString(),
        retryCount: retryCount + 1,
        lastError: errMsg,
        retriedAt: now.toISOString()
      };
      contentStatus = 'scheduled';
      log(`[SCHEDULER] ${platform} retry ${retryCount + 1}/${MAX_RETRIES} scheduled for ${content.id} at ${nextRetry.toISOString()} (error: ${errMsg})`, 'scheduler');
      // Снимаем блокировки чтобы следующий цикл планировщика смог подхватить retry
      this.releasePlatformCache(content.id, platform);
      publicationTracker.releasePublication(content.id, platform);
    } else {
      platformUpdate = {
        ...existing,
        status: 'failed',
        error: errMsg,
        errorCode: authError ? 'AUTH_ERROR' : permanentError ? 'PERMANENT_ERROR' : 'MAX_RETRIES_EXCEEDED',
        failedAt: now.toISOString(),
        retryCount
      };
      contentStatus = 'scheduled'; // пересчитывается ниже на основе реальных статусов платформ
      if (permanentError) {
        log(`[SCHEDULER] ${platform} немедленный failed (постоянная причина) для ${content.id}: ${errMsg}`, 'scheduler', 'error');
      } else {
        log(`[SCHEDULER] ${platform} exhausted retries (${MAX_RETRIES}) for ${content.id} — marking failed`, 'scheduler', 'error');
      }
    }

    try {
      const freshList = await directusCrud.list('campaign_content', {
        filter: { id: { _eq: content.id } },
        limit: 1,
        useAdminToken: true
      });
      const fresh = freshList?.[0];
      const platforms = fresh?.social_platforms || currentPlatforms;

      // Определяем реальный статус контента с учётом всех платформ
      const allPlatforms = { ...platforms, [platform]: platformUpdate };
      const hasAnyPending = Object.values(allPlatforms).some((p: any) => p.status === 'pending' || p.status === 'publishing');
      const hasAnyPublished = Object.values(allPlatforms).some((p: any) => p.status === 'published');
      const allDone = !hasAnyPending;
      const finalContentStatus = hasAnyPublished && allDone
        ? 'partially_published'            // часть опубликована, ретраев нет
        : hasAnyPublished && hasAnyPending
          ? 'partially_published'          // часть опубликована, часть ещё в очереди — шедулер подберёт частичную публикацию
          : hasAnyPending
            ? 'scheduled'                  // ничего не опубликовано, всё ещё ждёт
            // Задача 108: раньше здесь оставался рабочий статус — запись,
            // у которой УПАЛИ ВСЕ площадки, навсегда числилась «запланированной».
            : 'error';                      // всё failed — это окончательный отказ

      await directusCrud.update('campaign_content', content.id, {
        status: finalContentStatus,
        social_platforms: allPlatforms
      }, { useAdminToken: true });
      // Сбрасываем кеш — статус контента изменился
      if (content.user_id) invalidateContentCache(content.user_id, content.campaign_id);
    } catch (updateErr: any) {
      console.error(`[SCHEDULER] scheduleRetryOrFail update failed: ${updateErr.message}`);
    }
  }

  /**
   * Публикует контент в Threads напрямую через API (без N8N)
   */
  private async publishToThreadsDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация в Threads для контента ${content.id}`, 'scheduler');

      const directusUrl = process.env.DIRECTUS_URL;

      // Публикация ходит сервисным токеном: он даёт доступ к кампаниям всех
      // пользователей и не зависит от живой сессии владельца.
      const adminToken = await resolvePublishingToken();

      const rawCampaignId = content.campaign_id;
      const campaignId = typeof rawCampaignId === 'object' && rawCampaignId !== null
        ? rawCampaignId.id
        : rawCampaignId;

      console.error(`[THREADS-DIRECT] content.id=${content.id}, campaign_id raw type=${typeof rawCampaignId}, resolved=${campaignId}`);

      if (!campaignId) {
        throw new Error('Не указан campaign_id для контента');
      }

      let campaignResponse: any;
      try {
        campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
      } catch (httpErr: any) {
        const status = httpErr.response?.status;
        const body = JSON.stringify(httpErr.response?.data || {});
        console.error(`[THREADS-DIRECT] Campaign fetch FAILED: HTTP ${status} for campaign ${campaignId}: ${body}`);
        // Лесенка перебора токенов убрана вместе с пользовательским токеном: она
        // срабатывала только на 401 и не спасала от 403, который этот же
        // пользовательский токен и вызывал. Сервисный токен либо работает, либо
        // сломан по-настоящему — и тогда об этом надо знать, а не ретраить.
        throw new Error(`Ошибка загрузки кампании ${campaignId}: HTTP ${status}`);
      }

      const threadsSettings = campaignResponse.data.data.social_media_settings?.threads;
      console.error(`[THREADS-DIRECT] threadsSettings found: ${!!threadsSettings}, hasToken: ${!!threadsSettings?.accessToken}, hasUserId: ${!!threadsSettings?.threadsUserId}`);

      if (!threadsSettings?.accessToken || !threadsSettings?.threadsUserId) {
        throw new Error('Threads не настроен для кампании');
      }

      const { threadsService } = await import('./social-platforms/threads-service');
      const rawText = content.text_content || content.content || content.title || '';
      const rawStr = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
      // Threads не поддерживает Markdown — убираем **жирный**, *курсив* и прочие маркеры
      const text = stripMarkdown(rawStr);
      const imageUrl = content.image_url || undefined;
      const videoUrl = content.video_url || undefined;

      console.error(`[THREADS-DIRECT] Публикуем: text length=${text.length}, imageUrl=${imageUrl}, videoUrl=${videoUrl}`);
      const result = await threadsService.publishPost(threadsSettings, { text, imageUrl, videoUrl });
      console.error(`[THREADS-DIRECT] publishPost result: success=${result.success}, error=${result.error}`);

      if (result.success) {
        await this.savePublishedRecord(save, 'threads', { status: 'published', postId: result.postId, postUrl: result.postUrl, publishedAt: new Date().toISOString() }, content.id);
        // Кеш сбрасывает сам mergeAndSavePlatformStatus — отдельный вызов здесь больше не нужен.

        log(`Threads публикация успешна для ${content.id}: ${result.postUrl}`, 'scheduler');
        console.error(`[THREADS-DIRECT] SUCCESS: ${result.postUrl}`);

        notifyPublished({ contentId: content.id, platform: 'threads', message: 'Успешно опубликовано в Threads' });

        return { platform: 'threads', success: true };
      } else {
        throw new Error(result.error || 'Ошибка API Threads');
      }
    } catch (error: any) {
      const errMsg: string = error?.message || error?.response?.data?.error?.message || String(error) || 'Неизвестная ошибка Threads';
      console.error(`[THREADS-DIRECT] CATCH ERROR for ${content.id}: ${errMsg}`);
      log(`Ошибка публикации в Threads ${content.id}: ${errMsg}`, 'scheduler', 'error');
      const currentPlatformsForRetry = content.social_platforms || {};
      await this.scheduleRetryOrFail(content, 'threads', errMsg, currentPlatformsForRetry);
      return { platform: 'threads', success: false, error: errMsg };
    }
  }

  /**
   * Публикует контент в Facebook напрямую через API (без N8N)
   */
  private async publishToFacebookDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация в Facebook для контента ${content.id}`, 'scheduler');

      const directusUrl = process.env.DIRECTUS_URL;
      // Публикация — сервисным токеном, см. publishing-token.ts
      const adminToken = await resolvePublishingToken();

      const rawCampaignId = content.campaign_id;
      const campaignId = typeof rawCampaignId === 'object' && rawCampaignId !== null ? rawCampaignId.id : rawCampaignId;
      if (!campaignId) throw new Error('Не указан campaign_id для контента');

      const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      const fbSettings = campaignResponse.data.data.social_media_settings?.facebook;
      console.error(`[FB-DIRECT] fbSettings found: ${!!fbSettings}, hasToken: ${!!fbSettings?.token}, hasPageId: ${!!fbSettings?.pageId}`);

      if (!fbSettings?.token || !fbSettings?.pageId) {
        throw new Error('Facebook не настроен для кампании');
      }

      const { facebookService } = await import('./social-platforms/facebook-service');
      const rawText = content.text_content || content.content || content.title || '';
      const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
      const imageUrl = content.image_url || undefined;
      const videoUrl = content.video_url || undefined;

      console.error(`[FB-DIRECT] Публикуем: text=${text.length} chars, imageUrl=${imageUrl}, videoUrl=${videoUrl}`);
      const result = await facebookService.publishPost(fbSettings, { text, imageUrl, videoUrl });
      console.error(`[FB-DIRECT] publishPost result: success=${result.success}, error=${result.error}`);

      if (result.success) {
        await this.savePublishedRecord(save, 'facebook', { status: 'published', postId: result.postId, postUrl: result.postUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`Facebook публикация успешна для ${content.id}: ${result.postUrl}`, 'scheduler');
        console.error(`[FB-DIRECT] SUCCESS: ${result.postUrl}`);
        notifyPublished({ contentId: content.id, platform: 'facebook', message: 'Успешно опубликовано в Facebook' });
        return { platform: 'facebook', success: true };
      } else {
        throw new Error(result.error || 'Ошибка API Facebook');
      }
    } catch (error: any) {
      const errMsg: string = error?.message || String(error) || 'Неизвестная ошибка Facebook';
      console.error(`[FB-DIRECT] CATCH ERROR for ${content.id}: ${errMsg}`);
      log(`Ошибка публикации в Facebook ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'facebook', errMsg, content.social_platforms || {});
      return { platform: 'facebook', success: false, error: errMsg };
    }
  }

  /**
   * AI-102: разрешено ли сейчас печатать сохранённую ошибку terminal-записи.
   * Возвращает true при первой встрече, при смене текста ошибки и по истечении
   * часа. Карта чистится, чтобы не расти бесконечно.
   */
  shouldLogTerminalError(contentId: string, platform: string, error: string): boolean {
    const key = `${contentId}:${platform}:${error}`;
    const now = Date.now();
    const last = this.terminalErrorLoggedAt.get(key);
    if (last !== undefined && now - last < this.terminalErrorCooldownMs) return false;
    if (this.terminalErrorLoggedAt.size > this.maxCacheSize) {
      for (const [k, ts] of this.terminalErrorLoggedAt) {
        if (now - ts >= this.terminalErrorCooldownMs) this.terminalErrorLoggedAt.delete(k);
      }
    }
    this.terminalErrorLoggedAt.set(key, now);
    return true;
  }

  /**
   * Публикует контент в Telegram напрямую через Bot API (без N8N)
   */
  private async publishToTelegramDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация в Telegram для контента ${content.id}`, 'scheduler');

      const campaignId = typeof content.campaign_id === 'object' ? content.campaign_id?.id : content.campaign_id;
      if (!campaignId) throw new Error('Не указан campaign_id');

      // Публикация — сервисным токеном, см. publishing-token.ts
      const adminToken = await resolvePublishingToken();

      const campaignRes = await axios.get(`${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const settings = campaignRes.data.data.social_media_settings?.telegram;
      if (!settings?.token || !settings?.chatId) throw new Error('Telegram не настроен для кампании');

      const { telegramService } = await import('./social-platforms/telegram-service');
      const rawText = content.text_content || content.content || content.title || '';
      const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
      const result = await telegramService.publishPost(settings, {
        text,
        imageUrl: content.image_url,
        additionalImages: content.additional_images ?? content.additionalImages,
        videoUrl: content.video_url,
      });

      if (result.success) {
        await this.savePublishedRecord(save, 'telegram', { status: 'published', postId: String(result.messageId || ''), postUrl: result.postUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`Telegram успешно: ${result.postUrl}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'telegram' });
        return { platform: 'telegram', success: true };
      } else {
        throw new Error(result.error || 'Ошибка Telegram API');
      }
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      log(`Ошибка Telegram ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'telegram', errMsg, content.social_platforms || {});
      return { platform: 'telegram', success: false, error: errMsg };
    }
  }

  /**
   * Публикует контент ВКонтакте напрямую через VK API (без N8N)
   */
  private async publishToVkDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация в VK для контента ${content.id}`, 'scheduler');

      const campaignId = typeof content.campaign_id === 'object' ? content.campaign_id?.id : content.campaign_id;
      if (!campaignId) throw new Error('Не указан campaign_id');

      // Публикация — сервисным токеном, см. publishing-token.ts
      const adminToken = await resolvePublishingToken();

      const campaignRes = await axios.get(`${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      let settings = campaignRes.data.data.social_media_settings?.vk;
      if (!settings?.token) throw new Error('VK не настроен для кампании: отсутствует access_token. Подключите VK в настройках кампании.');
      if (!settings?.groupId) {
        log(`[VK] groupId не задан — сервис попробует авто-определить группу для campaign ${campaignId}`, 'scheduler');
      }

      const { vkService } = await import('./social-platforms/vk-service');
      const rawText = content.text_content || content.content || content.title || '';
      const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);

      // Всегда передаём campaignId — нужен внутри vkService для проактивного refresh токена
      // Fallback на VK_DEFAULT_APP_ID чтобы refresh работал даже без clientId в настройках кампании
      const { VK_DEFAULT_APP_ID } = await import('./social-platforms/vk-service');
      const vkClientId = settings.clientId || process.env.VK_APP_ID || VK_DEFAULT_APP_ID;
      const vkSettings = { ...settings, campaignId, clientId: vkClientId };

      // Проактивно обновляем токен ТОЛЬКО если он истекает в ближайшие 10 минут или дата неизвестна.
      // Не рефрешим перед каждой публикацией — это вызывает гонку при параллельных постах.
      const tokenExpiresAt = vkSettings.tokenExpiresAt ? new Date(vkSettings.tokenExpiresAt).getTime() : 0;
      const needsRefresh = vkSettings.refreshToken && vkClientId &&
        (!vkSettings.tokenExpiresAt || tokenExpiresAt < Date.now() + 10 * 60 * 1000);
      if (needsRefresh) {
        log(`[VK] Токен истекает менее чем через 10 минут (или дата неизвестна) — обновляем...`, 'scheduler');
        try {
          const { refreshAndSaveVkToken } = await import('./vk-token-refresh');
          const newToken = await refreshAndSaveVkToken(campaignId, vkSettings);
          if (newToken) {
            vkSettings.token = newToken;
            vkSettings.accessToken = newToken;
            log(`[VK] Токен успешно обновлён перед публикацией`, 'scheduler');
          }
        } catch (preRefreshErr: any) {
          log(`[VK] Предварительный refresh не удался: ${preRefreshErr.message}`, 'scheduler', 'warn');
        }
      }

      const vkContent = {
        text,
        imageUrl: content.image_url || content.imageUrl || content.featured_image || undefined,
        additionalImages: content.additional_images ?? content.additionalImages ?? [],
        videoUrl: content.video_url || content.videoUrl || undefined
      };
      let result = await vkService.publishPost(vkSettings, vkContent);

      if (!result.success && result.error && this.isAuthError(result.error) && vkSettings.refreshToken && vkClientId) {
        log(`[VK] Auth error после публикации, повторный token refresh для campaign ${campaignId}...`, 'scheduler');
        try {
          const { refreshAndSaveVkToken, markVkAuthExpiredIfTokenDead } = await import('./vk-token-refresh');
          const newToken = await refreshAndSaveVkToken(campaignId, vkSettings);
          if (newToken) {
            log(`[VK] Token refreshed, retrying publish for ${content.id}`, 'scheduler');
            result = await vkService.publishPost({ ...vkSettings, token: newToken, accessToken: newToken }, vkContent);
          } else {
            // null = ВРЕМЕННАЯ ошибка refresh (сеть, таймаут, VK лежит).
            // Раньше здесь безусловно ставился authExpired — сбой сети гасил
            // рабочую кампанию. Спрашиваем VK про сам access-токен.
            await markVkAuthExpiredIfTokenDead(campaignId, vkSettings.token || vkSettings.accessToken,
              'refresh вернул null (временная ошибка)');
          }
        } catch (refreshErr: any) {
          if (refreshErr.permanentFailure) {
            // Сгоревший одноразовый refresh-токен не означает мёртвый access-токен.
            const { markVkAuthExpiredIfTokenDead } = await import('./vk-token-refresh');
            await markVkAuthExpiredIfTokenDead(campaignId, vkSettings.token || vkSettings.accessToken,
              refreshErr.message);
          } else {
            log(`[VK] Ошибка refresh токена для campaign ${campaignId}: ${refreshErr.message}`, 'scheduler', 'error');
          }
        }
      } else if (!result.success && result.error && this.isAuthError(result.error) && !settings.refreshToken) {
        // Публикация упала с auth-ошибкой и обновиться нечем. isAuthError
        // разбирает свободный текст, поэтому вердикт всё равно подтверждаем
        // прямым вопросом к VK — иначе Access denied по одному объекту гасит
        // всю кампанию.
        const { markVkAuthExpiredIfTokenDead } = await import('./vk-token-refresh');
        await markVkAuthExpiredIfTokenDead(campaignId, vkSettings.token || vkSettings.accessToken,
          `auth-ошибка публикации без refresh_token: ${result.error}`);
      }

      if (result.success) {
        await this.savePublishedRecord(save, 'vk', { status: 'published', postId: String(result.postId || ''), postUrl: result.postUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`VK успешно: ${result.postUrl}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'vk' });
        return { platform: 'vk', success: true };
      } else {
        throw new Error(result.error || 'Ошибка VK API');
      }
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      log(`Ошибка VK ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'vk', errMsg, content.social_platforms || {});
      return { platform: 'vk', success: false, error: errMsg };
    }
  }

  /**
   * Публикует контент в Instagram напрямую через Graph API (без N8N)
   */
  private async publishToInstagramDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация в Instagram для контента ${content.id}`, 'scheduler');

      const campaignId = typeof content.campaign_id === 'object' ? content.campaign_id?.id : content.campaign_id;
      if (!campaignId) throw new Error('Не указан campaign_id');

      // Публикация — сервисным токеном, см. publishing-token.ts
      const adminToken = await resolvePublishingToken();

      const campaignRes = await axios.get(`${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const settings = campaignRes.data.data.social_media_settings?.instagram;
      if ((!settings?.accessToken && !settings?.token) || !settings?.businessAccountId) {
        throw new Error('Instagram не настроен для кампании');
      }

      const { instagramService } = await import('./social-platforms/instagram-service');
      const rawText = content.text_content || content.content || content.title || '';
      const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
      const result = await instagramService.publishPost(settings, { text, imageUrl: content.image_url, videoUrl: content.video_url }, content.id, process.env.DIRECTUS_STATIC_TOKEN);

      if (result.success) {
        await this.savePublishedRecord(save, 'instagram', { status: 'published', postId: result.postId, postUrl: result.postUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`Instagram успешно: ${result.postUrl}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'instagram' });
        return { platform: 'instagram', success: true };
      } else {
        throw new Error(result.error || 'Ошибка Instagram API');
      }
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      log(`Ошибка Instagram ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'instagram', errMsg, content.social_platforms || {});
      return { platform: 'instagram', success: false, error: errMsg };
    }
  }

  /**
   * Публикует видео в TikTok напрямую через Content Posting API.
   * Токены берутся из social_accounts (отдельная таблица, не из social_media_settings).
   * Требует video_url в контенте.
   */
  private async publishToTikTokDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация в TikTok для контента ${content.id}`, 'scheduler');

      const videoUrl: string | undefined = content.video_url || content.videoUrl;
      if (!videoUrl) {
        throw new Error('TikTok: контент не содержит video_url — публикация только видео');
      }

      const rawCampaignId = content.campaign_id;
      const campaignId = typeof rawCampaignId === 'object' && rawCampaignId !== null
        ? rawCampaignId.id
        : rawCampaignId;

      const userId = content.user_id;

      console.error(`[TIKTOK-DIRECT] content.id=${content.id}, campaign_id=${campaignId}, user_id=${userId}`);

      // Ищем TikTok аккаунт в social_accounts для данной кампании (или пользователя)
      // Используем directusCrud с admin токеном чтобы избежать 401 от непривилегированного DIRECTUS_TOKEN
      let account: any;
      try {
        const filter: Record<string, any> = {
          platform: { _eq: 'tiktok' },
          is_active: { _eq: true }
        };
        if (campaignId) filter['campaign_id'] = { _eq: campaignId };

        const accounts = await directusCrud.readMany('social_accounts', {
          filter,
          limit: 1,
          fields: ['id', 'access_token', 'refresh_token', 'expires_at', 'open_id', 'account_name', 'campaign_id', 'user_id'],
          useAdminToken: true
        });
        account = accounts?.[0];
      } catch (err: any) {
        console.error(`[TIKTOK-DIRECT] Failed to fetch social_accounts: ${err.message}`);
        throw new Error(`Ошибка получения TikTok аккаунта: ${err.message}`);
      }

      // Если не нашли по кампании — ищем по пользователю
      if (!account && userId) {
        console.error(`[TIKTOK-DIRECT] No account for campaign ${campaignId}, trying user_id=${userId}`);
        try {
          const accounts2 = await directusCrud.readMany('social_accounts', {
            filter: {
              platform: { _eq: 'tiktok' },
              is_active: { _eq: true },
              user_id: { _eq: userId }
            },
            limit: 1,
            fields: ['id', 'access_token', 'refresh_token', 'expires_at', 'open_id', 'account_name', 'campaign_id', 'user_id'],
            useAdminToken: true
          });
          account = accounts2?.[0];
        } catch (err2: any) {
          console.error(`[TIKTOK-DIRECT] Fallback user search failed: ${err2.message}`);
        }
      }

      if (!account?.access_token) {
        throw new Error('TikTok аккаунт не подключён. Авторизуйтесь через "Подключить TikTok" в настройках кампании.');
      }

      console.error(`[TIKTOK-DIRECT] Found account id=${account.id} name=${account.account_name}, expires_at=${account.expires_at || 'not set'}`);

      // Авторефреш токена если истёк или expires_at не задан (токен мог давно истечь)
      let accessToken: string = account.access_token;
      const needsRefresh = !account.expires_at || (() => {
        const expiresAt = new Date(account.expires_at);
        const msLeft = expiresAt.getTime() - Date.now();
        return msLeft < 5 * 60 * 1000;
      })();
      if (needsRefresh && account.refresh_token) {
        const msLeft = account.expires_at ? new Date(account.expires_at).getTime() - Date.now() : -1;
        console.error(`[TIKTOK-DIRECT] Token needs refresh (expires_at=${account.expires_at || 'null'}, msLeft=${msLeft}), refreshing...`);
        try {
            const { TikTokOAuth } = await import('../utils/tiktok-oauth');
            // Берём client_key/secret из env или Directus
            const clientKey = process.env.TIKTOK_CLIENT_KEY;
            const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
            let tiktokOAuth: any = null;
            if (clientKey && clientSecret) {
              tiktokOAuth = new TikTokOAuth({ clientKey, clientSecret, redirectUri: '' });
            } else {
              // Fallback: ищем в Directus api_keys
              try {
                const apiKeys = await directusCrud.readMany<any>('api_keys', {
                  filter: { service: { _eq: 'tiktok' }, is_active: { _eq: true } },
                  limit: 1,
                  useAdminToken: true
                });
                const ak = apiKeys?.[0];
                if (ak?.client_id && ak?.client_secret) {
                  tiktokOAuth = new TikTokOAuth({ clientKey: ak.client_id, clientSecret: ak.client_secret, redirectUri: '' });
                }
              } catch (keysError: any) {
                // AI-65. Молча оставить `tiktokOAuth` пустым — значит потерять
                // возможность обновить токен и не сказать об этом никому.
                logEvent(
                  'scheduler.platform_keys_unreadable',
                  {
                    operation: 'publish-cycle',
                    platform: 'tiktok',
                    reason: keysError?.message ? String(keysError.message) : 'unknown',
                  },
                  'warn',
                  'scheduler',
                  'Не удалось прочитать ключи приложения TikTok — обновление токена невозможно',
                );
              }
            }
            if (tiktokOAuth && account.refresh_token) {
              const newTokens = await tiktokOAuth.refreshAccessToken(account.refresh_token);
              accessToken = newTokens.accessToken;
              // Сохраняем обновлённые токены в Directus
              await directusCrud.update('social_accounts', account.id, {
                access_token: newTokens.accessToken,
                refresh_token: newTokens.refreshToken || account.refresh_token,
                expires_at: new Date(Date.now() + newTokens.expiresIn * 1000).toISOString()
              }, { useAdminToken: true });
              console.error(`[TIKTOK-DIRECT] Token refreshed successfully, new expiry: ${new Date(Date.now() + newTokens.expiresIn * 1000).toISOString()}`);
            } else {
              console.error(`[TIKTOK-DIRECT] Cannot refresh: missing OAuth config or refresh_token`);
            }
          } catch (refreshErr: any) {
            console.error(`[TIKTOK-DIRECT] Token refresh failed: ${refreshErr.message} — using existing token`);
          }
      }

      const { tiktokService } = await import('./social-platforms/tiktok-service');
      const caption = content.text_content || content.content || content.title || '';

      const result = await tiktokService.publishAndWait({
        accessToken,
        videoUrl,
        caption
      });

      console.error(`[TIKTOK-DIRECT] publishAndWait result: success=${result.success}, publishId=${result.publishId}, postUrl=${result.postUrl}`);

      if (result.success) {
        await this.savePublishedRecord(save, 'tiktok', { status: 'published', publishId: result.publishId, postUrl: result.postUrl || 'https://www.tiktok.com', publishedAt: new Date().toISOString() }, content.id);
        log(`TikTok публикация успешна для ${content.id}: publishId=${result.publishId}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'tiktok', message: 'Успешно опубликовано в TikTok' });
        return { platform: 'tiktok', success: true };
      } else {
        throw new Error(result.error || 'Ошибка API TikTok');
      }
    } catch (error: any) {
      const errMsg: string = error?.message || String(error) || 'Неизвестная ошибка TikTok';
      console.error(`[TIKTOK-DIRECT] CATCH ERROR for ${content.id}: ${errMsg}`);
      log(`Ошибка публикации в TikTok ${content.id}: ${errMsg}`, 'scheduler', 'error');

      const isPermanentError = (
        errMsg.includes('integration guidelines') ||
        errMsg.includes('unaudited_client') ||
        errMsg.includes('spam_risk_user_banned') ||
        errMsg.includes('reached_active_user_cap')
      );
      if (isPermanentError) {
        console.error(`[TIKTOK-DIRECT] Permanent error — marking failed immediately (no retry): ${errMsg}`);
        await save('tiktok', { status: 'failed', error: errMsg, failedAt: new Date().toISOString() });
        return { platform: 'tiktok', success: false, error: errMsg };
      }

      await this.scheduleRetryOrFail(content, 'tiktok', errMsg, content.social_platforms || {});
      return { platform: 'tiktok', success: false, error: errMsg };
    }
  }

  /**
   * Публикует VK Stories напрямую через VK API
   */
  private async publishToVkStoriesDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация VK Story для контента ${content.id}`, 'scheduler');
      const adminToken = (await resolvePublishingToken()) ?? undefined;
      const { vkStoriesService } = await import('./social-platforms/vk-stories-service');
      const result = await vkStoriesService.publishStory(content.id, adminToken, content);
      if (result.success) {
        await this.savePublishedRecord(save, 'vk', { status: 'published', postUrl: result.storyUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`VK Story опубликована успешно: ${result.storyUrl}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'vk', type: 'story' });
        return { platform: 'vk', success: true };
      }
      throw new Error(result.error || 'Ошибка VK Stories API');
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      log(`Ошибка VK Story ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'vk', errMsg, content.social_platforms || {});
      return { platform: 'vk', success: false, error: errMsg };
    }
  }

  /**
   * Публикует VK Clips (короткие видео) напрямую через VK API
   */
  private async publishToVkClipsDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация VK Clip для контента ${content.id}`, 'scheduler');
      if (!content.video_url) throw new Error('VK Clips: контент не содержит video_url');
      const adminToken = (await resolvePublishingToken()) ?? undefined;
      const { vkClipsService } = await import('./social-platforms/vk-clips-service');
      const result = await vkClipsService.publishClip(content.id, adminToken);
      if (result.success) {
        await this.savePublishedRecord(save, 'vk', { status: 'published', postUrl: result.videoUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`VK Clip опубликован успешно: ${result.videoUrl}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'vk', type: 'clip' });
        return { platform: 'vk', success: true };
      }
      throw new Error(result.error || 'Ошибка VK Clips API');
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      log(`Ошибка VK Clip ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'vk', errMsg, content.social_platforms || {});
      return { platform: 'vk', success: false, error: errMsg };
    }
  }

  /**
   * Публикует Instagram Reels напрямую через Graph API
   */
  private async publishToInstagramReelsDirect(content: any, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}): Promise<{ platform: string; success: boolean; error?: string }> {
    try {
      log(`Планировщик: Прямая публикация Instagram Reels для контента ${content.id}`, 'scheduler');
      if (!content.video_url) throw new Error('Instagram Reels: контент не содержит video_url');
      const adminToken = (await resolvePublishingToken()) ?? undefined;
      const { instagramReelsService } = await import('./social-platforms/instagram-reels-service');
      const result = await instagramReelsService.publishReels(content.id, adminToken);
      if (result.success) {
        await this.savePublishedRecord(save, 'instagram', { status: 'published', postUrl: result.postUrl, publishedAt: new Date().toISOString() }, content.id);
        log(`Instagram Reels опубликован успешно: ${result.postUrl}`, 'scheduler');
        notifyPublished({ contentId: content.id, platform: 'instagram', type: 'reels' });
        return { platform: 'instagram', success: true };
      }
      throw new Error(result.error || 'Ошибка Instagram Reels API');
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      log(`Ошибка Instagram Reels ${content.id}: ${errMsg}`, 'scheduler', 'error');
      await this.scheduleRetryOrFail(content, 'instagram', errMsg, content.social_platforms || {});
      return { platform: 'instagram', success: false, error: errMsg };
    }
  }

  /**
   * Определяет тип контента для платформы
   */
  private getContentType(content: any): string {
    const ct = (content.content_type || '').toLowerCase();
    const metadata = content.metadata;
    if (ct) return ct;
    if (metadata) {
      const meta = typeof metadata === 'string' ? (() => { try { return JSON.parse(metadata); } catch { return {}; } })() : metadata;
      if (meta.storyType || meta.content_type) return (meta.storyType || meta.content_type).toLowerCase();
    }
    return 'post';
  }

  /**
   * Публикует контент в указанные платформы напрямую (без N8N)
   */
  private async adaptContentForPlatform(text: string, platform: string): Promise<string> {
    const styleGuide = PLATFORM_STYLE[platform];
    if (!styleGuide) return text; // платформа без правил — без изменений

    try {
      const prompt = `Ты — редактор SMM-контента. Адаптируй пост под требования платформы.
Верни ТОЛЬКО адаптированный текст — без пояснений и заголовков.

${styleGuide}

ИСХОДНЫЙ ПОСТ:
---
${text}
---

АДАПТИРОВАННЫЙ ПОСТ:`;

      const result = await aiService.generateContent({
        prompt,
        model: 'gemini-2.5-flash',
        service: 'gemini'
      });

      const adapted = (result.content || '').trim();
      // Для Telegram конвертируем Markdown → HTML; для остальных — просто стрипаем
      const cleanFn = platform === 'telegram' ? markdownToTelegramHtml : stripMarkdown;

      if (!adapted || adapted.length < 30) {
        log(`[PLATFORM-ADAPT] ⚠️ ${platform}: пустой ответ, используем оригинал`, 'scheduler');
        return cleanFn(text);
      }

      const clean = cleanFn(adapted);
      log(`[PLATFORM-ADAPT] ✅ ${platform}: ${text.length} → ${clean.length} символов`, 'scheduler');
      return clean;
    } catch (err: any) {
      log(`[PLATFORM-ADAPT] ⚠️ ${platform}: ошибка адаптации (${err.message?.slice(0, 80)}), используем оригинал`, 'scheduler');
      return platform === 'telegram' ? markdownToTelegramHtml(text) : stripMarkdown(text);
    }
  }

  /**
   * Записывает результат СОСТОЯВШЕЙСЯ публикации (AI-85).
   *
   * До этой обёртки запись результата стояла внутри того же try, что и сама
   * отправка, поэтому сбой базы попадал в общий catch и обрабатывался как сбой
   * публикации: планировщик назначал повтор и отправлял пост второй раз.
   * Пост при этом уже был у подписчиков.
   *
   * Здесь эти два события разведены. Отправка состоялась — значит она состоялась,
   * и повтора быть не должно ни при каких ошибках записи. Если базу дописать не
   * удалось, факт уходит в файловый журнал, который переживёт недоступность базы
   * и не даст опубликовать то же самое ещё раз.
   *
   * Метод не бросает исключений — это его главное свойство.
   */
  private async savePublishedRecord(
    save: (p: string, d: Record<string, any>) => Promise<void>,
    platform: string,
    fields: Record<string, any>,
    contentId: string
  ): Promise<boolean> {
    try {
      await save(platform, fields);
      return true;
    } catch (recordErr: any) {
      const recordError = recordErr?.message || String(recordErr);
      await recordPublished({
        contentId,
        platform,
        fields,
        publishedAt: String(fields.publishedAt || new Date().toISOString()),
        recordError,
      });
      // Пометка нужна интерфейсу и планировщику: пост ушёл, запись не сохранилась.
      // Она пишется той же базой, что только что отказала, поэтому попытка
      // best-effort — её провал уже не может ничего испортить.
      try {
        await save(platform, { ...fields, status: 'publish_succeeded_record_failed', error: recordError });
      } catch {
        // база всё ещё недоступна — факт уже сохранён в журнале
      }
      return false;
    }
  }

  /**
   * Догоняет записи, которые не удалось сохранить в момент публикации (AI-85).
   * Вызывается в начале каждого цикла: как только база отвечает, журнал пустеет.
   */
  private async reconcilePublishJournal(): Promise<number> {
    let healed = 0;
    let entries: Awaited<ReturnType<typeof readJournal>> = [];
    try {
      entries = await readJournal();
    } catch {
      return 0;
    }
    for (const entry of entries) {
      try {
        const freshList = await directusCrud.list('campaign_content', {
          filter: { id: { _eq: entry.contentId } },
          limit: 1,
          useAdminToken: true
        });
        const fresh: any = freshList?.[0];
        if (!fresh) {
          // материал удалён — держать строку больше незачем
          await forget(entry.contentId, entry.platform);
          continue;
        }
        const currentPlatforms = fresh.social_platforms || {};
        await directusCrud.update('campaign_content', entry.contentId, {
          social_platforms: {
            ...currentPlatforms,
            [entry.platform]: { ...(currentPlatforms[entry.platform] || {}), ...entry.fields, status: 'published' }
          }
        }, { useAdminToken: true });
        await forget(entry.contentId, entry.platform);
        healed++;
        log(`[AI-85] Догнал запись публикации ${entry.platform} для ${entry.contentId}`, 'scheduler');
      } catch (err: any) {
        log(`[AI-85] Догнать запись ${entry.platform} для ${entry.contentId} пока не удалось: ${err?.message || err}`, 'scheduler', 'warn');
      }
    }
    return healed;
  }

  private async publishContentToPlatforms(content: any, platforms: string[]) {
    // Mutex для сериализации всех записей в Directus — предотвращает race condition при
    // параллельной публикации нескольких платформ: без mutex каждая платформа читает
    // social_platforms = {}, потом пишет свой результат, перезаписывая результаты других.
    let saveMutex = Promise.resolve<void>(undefined);
    const atomicSave = (fn: () => Promise<void>): Promise<void> => {
      // Цепочка промисов: каждый следующий ждёт предыдущего, даже если тот упал
      saveMutex = saveMutex.then(fn, fn);
      return saveMutex;
    };

    const mergeAndSavePlatformStatus = (platform: string, data: Record<string, any>): Promise<void> => {
      return atomicSave(async () => {
        const freshList = await directusCrud.list('campaign_content', {
          filter: { id: { _eq: content.id } },
          limit: 1,
          useAdminToken: true
        });
        const fresh = freshList?.[0];
        const currentPlatforms = fresh?.social_platforms || content.social_platforms || {};
        await directusCrud.update('campaign_content', content.id, {
          social_platforms: { ...currentPlatforms, [platform]: { ...(currentPlatforms[platform] || {}), ...data } }
        }, { useAdminToken: true });
        // Единственная точка записи статуса платформы в планировщике — отсюда и
        // сбрасываем кеш. Раньше это делали вручную у отдельных платформ, и из 14
        // вызовов save() инвалидация стояла у двух: остальные оставляли морде
        // устаревшую карточку на всю CONTENT_CACHE_TTL после успешной публикации.
        if (content.user_id) invalidateContentCache(content.user_id, content.campaign_id);

        // AI-65. Событие ставится здесь, потому что это единственная точка, через
        // которую проходит итог любой площадки. В каждом из методов публикации
        // ставить нельзя: новая площадка появится без события, и никто не заметит.
        const event = publishOutcomeEvent(data.status);
        if (event) {
          logEvent(
            event,
            {
              platform,
              contentId: content.id,
              campaignId: content.campaign_id,
              ...(event === 'publish.succeeded' ? {} : { reason: classifyPublishFailure(data.error) }),
            },
            event === 'publish.succeeded' ? 'info' : 'error',
            'scheduler',
          );
        }
      });
    };

    const publishOne = async (platform: string) => {
      try {
        const contentType = this.getContentType(content);
        const isStory = contentType === 'story';
        const isClip  = contentType === 'clip';
        const isReel  = contentType === 'clip';
        const THREADS_CHAR_LIMIT = 500;

        let publishContent = content;
        if (!isStory && !isClip) {
          try {
            let shouldAdapt = platform === 'threads';
            if (!shouldAdapt) {
              const campaignId = content.campaign_id || content.campaignId;
              if (campaignId) {
                const camp: any = await directusCrud.getById('user_campaigns', campaignId, { useAdminToken: true });
                const rawSettings = camp?.autonomous_settings;
                let autoSettings: { useEditorPass?: boolean } = {};
                if (rawSettings && typeof rawSettings === 'object') autoSettings = rawSettings;
                else if (typeof rawSettings === 'string') {
                  try { autoSettings = JSON.parse(rawSettings); } catch { /* ignore */ }
                }
                shouldAdapt = !!autoSettings.useEditorPass;
              }
            }
            if (shouldAdapt) {
              const rawText = content.text_content || content.content || '';
              if (rawText) {
                let adaptedText = await this.adaptContentForPlatform(rawText, platform);
                if (platform === 'threads' && adaptedText.length > THREADS_CHAR_LIMIT) {
                  adaptedText = adaptedText.slice(0, THREADS_CHAR_LIMIT);
                  const lastSpace = adaptedText.lastIndexOf(' ');
                  if (lastSpace > THREADS_CHAR_LIMIT * 0.7) adaptedText = adaptedText.slice(0, lastSpace);
                  adaptedText = adaptedText.trimEnd();
                  log(`[THREADS-ADAPT] ✂️ Обрезан до ${adaptedText.length} символов`, 'scheduler');
                }
                if (adaptedText !== rawText) publishContent = { ...content, text_content: adaptedText, content: adaptedText };
              }
            }
          } catch (err: any) {
            log(`[PLATFORM-ADAPT] ⚠️ Не удалось адаптировать контент: ${err.message?.slice(0, 80)}`, 'scheduler');
            if (platform === 'threads') {
              const rawText = content.text_content || content.content || '';
              if (rawText && typeof rawText === 'string' && rawText.length > THREADS_CHAR_LIMIT) {
                const truncated = stripMarkdown(rawText).slice(0, THREADS_CHAR_LIMIT).trimEnd();
                publishContent = { ...content, text_content: truncated, content: truncated };
                log(`[THREADS-ADAPT] ✂️ Аварийная обрезка до ${truncated.length} символов`, 'scheduler');
              }
            }
          }
        }

        // 🛡️ PRE-PUBLISH: через atomicSave — сериализуем с остальными записями,
        // чтобы параллельные платформы не перезаписали друг друга.
        let shouldAbort = false;
        try {
          await atomicSave(async () => {
            const freshList = await directusCrud.list('campaign_content', {
              filter: { id: { _eq: content.id } },
              limit: 1,
              useAdminToken: true
            });
            const freshPre = freshList?.[0];
            const currentPlatformsPre = freshPre?.social_platforms || content.social_platforms || {};
            const existingPlatformDataPre = currentPlatformsPre[platform] || {};

            if (existingPlatformDataPre.status === 'published' || existingPlatformDataPre.postUrl) {
              log(`⛔ Pre-publish: ${content.id}:${platform} уже опубликован — пропускаем`, 'scheduler');
              shouldAbort = true;
              return;
            }

            // Мержим только свой ключ, не трогая остальные платформы
            await directusCrud.update('campaign_content', content.id, {
              social_platforms: {
                ...currentPlatformsPre,
                [platform]: { ...existingPlatformDataPre, status: 'publishing', publishingAt: new Date().toISOString() }
              }
            }, { useAdminToken: true });
            log(`🔒 Pre-publish: 'publishing' для ${content.id}:${platform}`, 'scheduler', 'debug');
          });
        } catch (prePublishErr: any) {
          log(`⚠️ Pre-publish error ${content.id}:${platform}: ${prePublishErr.message}`, 'scheduler', 'warn');
        }

        // AI-85: проверка выше опирается на базу, а именно её недоступность и
        // порождает дубли — при сбое ветка выше только предупреждает и пускает
        // публикацию дальше. Журнал переживает недоступность базы и отвечает на
        // тот же вопрос: этот материал на эту площадку уже уходил?
        if (!shouldAbort) {
          const already = await wasPublished(content.id, platform);
          if (already) {
            log(`\u26d4 Pre-publish: ${content.id}:${platform} уже опубликован ${already.publishedAt} (журнал AI-85) — не публикуем повторно`, 'scheduler');
            shouldAbort = true;
          }
        }

        if (shouldAbort) {
          await publicationLockManager.releaseLock(content.id, platform);
          return;
        }

        if (platform === 'threads') {
          await this.publishToThreadsDirect(publishContent, mergeAndSavePlatformStatus);
        } else if (platform === 'facebook') {
          await this.publishToFacebookDirect(publishContent, mergeAndSavePlatformStatus);
        } else if (platform === 'telegram') {
          await this.publishToTelegramDirect(publishContent, mergeAndSavePlatformStatus);
        } else if (platform === 'vk') {
          if (isStory) {
            log(`VK Story режим для ${content.id}`, 'scheduler');
            await this.publishToVkStoriesDirect(content, mergeAndSavePlatformStatus);
          } else if (isClip) {
            log(`VK Clip режим для ${content.id}`, 'scheduler');
            await this.publishToVkClipsDirect(content, mergeAndSavePlatformStatus);
          } else {
            await this.publishToVkDirect(publishContent, mergeAndSavePlatformStatus);
          }
        } else if (platform === 'instagram') {
          if (isReel && content.video_url) {
            log(`Instagram Reels режим для ${content.id}`, 'scheduler');
            await this.publishToInstagramReelsDirect(publishContent, mergeAndSavePlatformStatus);
          } else {
            await this.publishToInstagramDirect(publishContent, mergeAndSavePlatformStatus);
          }
        } else if (platform === 'youtube') {
          const authToken = (await resolvePublishingToken()) || '';
          await this.publishToYouTubeDirect(publishContent, authToken, mergeAndSavePlatformStatus);
        } else if (platform === 'tiktok') {
          log(`TikTok публикация отключена для ${content.id} — платформа временно недоступна`, 'scheduler');
          await mergeAndSavePlatformStatus('tiktok', { status: 'failed', error: 'TikTok временно отключён', failedAt: new Date().toISOString() });
        } else {
          log(`[Планировщик] Платформа ${platform} не поддерживается для прямой публикации, контент ${content.id}`, 'scheduler', 'warn');
          await mergeAndSavePlatformStatus(platform, {
            status: 'failed',
            error: `Платформа ${platform} не поддерживает автоматическую публикацию`,
            failedAt: new Date().toISOString()
          });
        }

        await publicationLockManager.releaseLock(content.id, platform);
      } catch (error: any) {
        log(`Ошибка публикации ${content.id} в ${platform}: ${error.message}`, 'scheduler', 'error');
        await publicationLockManager.releaseLock(content.id, platform);
      }
    };

    // Запускаем все платформы параллельно — каждая сама читает и мержит свой ключ
    await Promise.allSettled(platforms.map(platform => publishOne(platform)));

    // Обновляем общий статус контента
    await this.updateContentStatus(content.id);
  }

  /**
   * Публикует контент в YouTube напрямую через API
   */
  private async publishToYouTubeDirect(content: any, authToken: string, save: (p: string, d: Record<string, any>) => Promise<void> = async () => {}) {
    try {
      log(`Планировщик: Прямая публикация в YouTube для контента ${content.id}`, 'scheduler');
      
      // Получаем данные кампании
      const campaign = await this.getCampaignData(content.campaign_id, authToken);
      if (!campaign) {
        throw new Error('Не удалось получить данные кампании');
      }

      // Используем социальный сервис для публикации
      const { socialPublishingService } = await import('./social/index');
      const result = await socialPublishingService.publishToPlatform(content, 'youtube', campaign, authToken);

      if (result.status === 'published') {
        log(`YouTube публикация успешна для контента ${content.id}: ${result.postUrl}`, 'scheduler');
        try {
          await this.savePublishedRecord(save, 'youtube', { status: 'published', postUrl: result.postUrl, platform: 'youtube', publishedAt: result.publishedAt || new Date().toISOString(), videoId: result.videoId || null }, content.id);
          log(`YouTube результат сохранен для контента ${content.id}`, 'scheduler');
        } catch (saveError: any) {
          log(`Ошибка сохранения YouTube результата: ${saveError.message}`, 'scheduler');
        }
        notifyPublished({ contentId: content.id, platform: 'youtube', message: 'Успешно опубликовано в YouTube' });
        return { platform: 'youtube', success: true };
      } else {
        if (result.quotaExceeded || (result.error && result.error.includes('quota'))) {
          log(`YouTube quota exceeded для контента ${content.id}`, 'scheduler');
          try {
            await save('youtube', { status: 'quota_exceeded', platform: 'youtube', error: result.error || 'YouTube quota exceeded', updatedAt: new Date().toISOString() });
            await this.updateContentStatus(content.id);
          } catch (updateError: any) {
            log(`Ошибка записи quota_exceeded: ${updateError.message}`, 'scheduler');
          }
        }
        throw new Error(result.error || 'Неизвестная ошибка YouTube API');
      }

    } catch (error: any) {
      log(`Ошибка публикации YouTube ${content.id}: ${error.message}`, 'scheduler');
      if (error.message && (error.message.includes('quota') || error.message.includes('Quota'))) {
        log(`YouTube quota exceeded в исключении для контента ${content.id}`, 'scheduler');
        try {
          await save('youtube', { status: 'quota_exceeded', platform: 'youtube', error: error.message, updatedAt: new Date().toISOString() });
          await this.updateContentStatus(content.id);
        } catch (updateError: any) {
          log(`Ошибка записи quota_exceeded: ${updateError.message}`, 'scheduler');
        }
      }
      return { platform: 'youtube', success: false, error: error.message };
    }
  }

  /**
   * Публикует контент через N8N webhook
   */
  private async publishThroughN8nWebhook(content: any, platform: string) {
    // Проверяем тип контента для Instagram Stories
    const isStory = content.content_type === 'story' || 
                   (content.metadata && (
                     (typeof content.metadata === 'string' && content.metadata.includes('storyType')) ||
                     (typeof content.metadata === 'object' && content.metadata.storyType)
                   ));

    // Маппинг платформ на N8N webhook endpoints
    const webhookMap: Record<string, string> = {
      'telegram': 'publish-telegram',
      'vk': 'publish-vk',
      'instagram': isStory ? 'publish-stories' : 'publish-instagram', 
      'facebook': 'publish-facebook',
      'youtube': 'publish-youtube'
    };

    const platformString = platform.toLowerCase();
    const webhookName = webhookMap[platformString] || `publish-${platformString}`;
    
    log(`🎬 Планировщик: Контент ${content.id} - тип: ${content.content_type}, является Stories: ${isStory}, webhook: ${webhookName}`, 'scheduler');

    // Формируем URL для N8N webhook (используем центральную функцию)
    const n8nBaseUrl = getN8nUrl();
    const isProduction = process.env.NODE_ENV === 'production';
    log(`${isProduction ? '🏭' : '🔧'} [N8N] ${isProduction ? 'Production' : 'Development'} mode - using: ${n8nBaseUrl}`, 'scheduler', 'debug');

    const baseUrl = n8nBaseUrl.endsWith('/') ? n8nBaseUrl.slice(0, -1) : n8nBaseUrl;
    const webhookUrl = baseUrl.includes('/webhook') 
      ? `${baseUrl}/${webhookName}`
      : `${baseUrl}/webhook/${webhookName}`;

    // Отправляем запрос в N8N для публикации
    log(`🚀 Sending request to: ${webhookUrl} for content ${content.id}`, 'scheduler', 'debug');

    // Вспомогательная функция: получаем свежие данные и обновляем только нашу платформу
    const updatePlatformStatus = async (fields: Record<string, any>) => {
      try {
        const freshList = await directusCrud.list('campaign_content', {
          filter: { id: { _eq: content.id } },
          limit: 1,
          useAdminToken: true
        });
        const freshContent = freshList?.[0];
        const currentPlatforms = freshContent?.social_platforms || content.social_platforms || {};
        const existingPlatformData = currentPlatforms[platform] || {};

        // Не перезаписываем если N8N уже успел записать финальный статус
        if (existingPlatformData.status === 'published') {
          log(`⏭️ [N8N-SCHEDULER] ${platform} уже published, пропускаем обновление`, 'scheduler', 'debug');
          return;
        }

        await directusCrud.update('campaign_content', content.id, {
          social_platforms: {
            ...currentPlatforms,
            [platform]: {
              ...existingPlatformData,
              ...fields
            }
          }
        }, { useAdminToken: true });
      } catch (updateErr: any) {
        console.error(`[N8N-SCHEDULER] Failed to update ${platform} status for ${content.id}: ${updateErr.message}`);
      }
    };
    
    // Очищаем Markdown из текста перед тем как n8n прочитает запись из Directus
    try {
      const rawText = content.text_content || content.content || '';
      if (rawText && typeof rawText === 'string') {
        const cleanText = stripMarkdown(rawText);
        if (cleanText !== rawText) {
          await directusCrud.update('campaign_content', content.id, {
            text_content: cleanText,
            content: cleanText
          }, { useAdminToken: true });
          log(`[MARKDOWN-STRIP] Cleaned markdown for ${content.id} before ${platform} n8n publish`, 'scheduler', 'debug');
        }
      }
    } catch (stripErr: any) {
      log(`[MARKDOWN-STRIP] Warning: failed to strip markdown for ${content.id}: ${stripErr.message}`, 'scheduler', 'warn');
    }

    try {
      const response = await axios.post(webhookUrl, {
        contentId: content.id
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      log(`✅ Request sent successfully to ${webhookUrl}, status: ${response.status}`, 'scheduler', 'debug');

      // Помечаем платформу как "в процессе публикации через N8N" с меткой времени для таймаута
      await updatePlatformStatus({ status: 'publishing', updatedAt: new Date().toISOString() });
    } catch (axiosError: any) {
      console.error(`[N8N-SCHEDULER] ❌ Request failed to ${webhookUrl} for ${platform} (${content.id}): ${axiosError.message}`);
      log(`❌ Request failed to ${webhookUrl}: ${axiosError.message}`, 'scheduler', 'error');

      // Сохраняем ошибку в статус платформы
      await updatePlatformStatus({ status: 'failed', error: axiosError.message });
      throw axiosError;
    }

    // Контент успешно отправлен в N8N
    
    // Отправляем уведомление в UI. AI-65: молчание здесь верное — контент уже
    // ушёл в n8n, — но принимается оно теперь один раз, в notifyPublished.
    const platformNames: Record<string, string> = {
      'instagram': 'Instagram',
      'facebook': 'Facebook',
      'vk': 'ВКонтакте',
      'telegram': 'Telegram'
    };
    const platformName = platformNames[platform.toLowerCase()] || platform;
    notifyPublished({
      contentId: content.id,
      platform,
      message: `Отправлено в N8N для публикации в ${platformName}`,
    });
    
    return { platform, success: true };
  }

  /**
   * Получает данные кампании
   */
  private async getCampaignData(campaignId: string, authToken: string) {
    try {
      const response = await axios.get(`${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          fields: 'id,name,social_media_settings'
        }
      });
      return response.data.data;
    } catch (error: any) {
      return null;
    }
  }

  /**
   * Обновляет общий статус контента на основе статусов всех платформ
   */
  private async updateContentStatus(contentId: string) {
    try {
      // Получаем актуальные данные контента через directusCrud
      const contentList = await directusCrud.list('campaign_content', {
        filter: { id: { _eq: contentId } },
        limit: 1,
        useAdminToken: true
      });
      const freshContent = contentList[0];
      if (!freshContent?.social_platforms) return;

      let platforms = freshContent.social_platforms;
      if (typeof platforms === 'string') {
        platforms = JSON.parse(platforms);
      }

      // Статус и published_at обязаны решаться одним и тем же способом, что и в
      // publish-now: платформа считается опубликованной по postId/postUrl даже без
      // publishedAt (isConfirmedPublishedPlatform), а getContentAggregateTimes
      // собирает дату только из publishedAt. На этой развилке контент получал
      // status='published' с пустым published_at и молча выпадал из всех разрезов
      // по времени. resolvePublishFinalization закрывает её фолбэком на now.
      const finalization = resolvePublishFinalization(platforms, freshContent.status, {
        scheduledAt: freshContent.scheduled_at,
        publishedAt: freshContent.published_at,
      });
      const newStatus = finalization.status;
      const resolvedPublishedAt = finalization.publishedAt
        ? finalization.publishedAt.toISOString()
        : null;

      const summaryTimes = getContentAggregateTimes(platforms, newStatus, {
        scheduledAt: freshContent.scheduled_at,
        publishedAt: freshContent.published_at,
      });
      const updateData: any = {};
      if (newStatus !== freshContent.status) updateData.status = newStatus;

      // Сравниваем моменты, а не строки: слева ISO с 'Z', справа голая метка из базы.
      // При непустом TZ процесса наивное new Date() читало правую как местное время,
      // расхождение казалось настоящим, и планировщик переписывал scheduled_at каждый
      // цикл, сдвигая его (AI-115).
      const sameInstant = isSameStoredInstant;

      if (!sameInstant(resolvedPublishedAt, freshContent.published_at)) {
        updateData.published_at = resolvedPublishedAt;
      }
      if (!sameInstant(summaryTimes.scheduledAt, freshContent.scheduled_at)) {
        updateData.scheduled_at = summaryTimes.scheduledAt;
      }

      if (Object.keys(updateData).length > 0) {
        await directusCrud.update('campaign_content', contentId, updateData, { useAdminToken: true });
        log(`Агрегаты контента ${contentId} синхронизированы со временем платформ`, 'scheduler');
      }

    } catch (error: any) {
      log(`Ошибка при обновлении статуса контента ${contentId}: ${error.message}`, 'scheduler');
    }
  }
}

// Создаем единственный экземпляр планировщика
let publishSchedulerInstance: PublishScheduler | null = null;

export function getPublishScheduler(): PublishScheduler {
  if (!publishSchedulerInstance) {
    publishSchedulerInstance = new PublishScheduler();
    log('✅ Планировщик публикаций инициализирован через синглтон', 'scheduler');
  }
  return publishSchedulerInstance;
}
