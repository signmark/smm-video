export type { AIAssistantRequest, AIAssistantResponse, CommandAnalysis, AvailableFunction } from './types';

import type { AIAssistantRequest, AIAssistantResponse } from './types';
import { handleAutonomousAIWithAPI } from './autonomous';
import { aiRoutingAnalyzeCommand, initializeAvailableFunctions } from './command-routing';
import {
  handleFillQuestionnaire,
  handleReadQuestionnaire,
  handleCreatePostsFromQuestionnaire,
  handleGetCampaignData,
  handleManageContent,
  handleCreatePosts,
  handleSchedulePosts,
  handleHelp,
  handleUnknownCommand,
  handleAnalyzeCampaign,
  handleCreateStories,
  handleGetAnalytics,
  handleSetupSocialAccounts,
  handlePublishContent,
  handleAnalyzeTrends,
  handleCollectTrends,
  handleCreateCampaign,
  handleStartScheduler,
  handleStopScheduler,
  handleOptimizeContent,
  handleAnalyzeCompetitors,
  handleGenerateHashtags,
  handleScheduleOptimalTime,
} from './command-handlers';

export class AIAssistantService {
  private availableFunctions = initializeAvailableFunctions();

  async processCommand(request: AIAssistantRequest): Promise<AIAssistantResponse> {
    try {
      console.log('[AI-ASSISTANT] 🎯 Обработка команды через автономную AI-систему:', request.message);
      
      const { aiConversationStorage } = await import('../ai-conversation-storage');
      const userId = request.userId;
      
      if (userId) {
        try {
          const conversationHistory = await aiConversationStorage.loadHistory(userId, undefined, 9);
          
          await aiConversationStorage.saveMessage({
            user_id: userId,
            chat_id: undefined,
            campaign_id: request.campaignId,
            role: 'user',
            content: request.message,
            timestamp: new Date()
          });
          
          if (!request.chatHistory) {
            request.chatHistory = [];
          }
          
          const dbHistory = aiConversationStorage.formatHistoryForAI(conversationHistory);
          request.chatHistory = [
            ...dbHistory,
            ...request.chatHistory,
            { role: 'user' as const, content: request.message, timestamp: new Date() }
          ];
          
          console.log('[AI-ASSISTANT] 📚 Загружено сообщений из БД:', conversationHistory.length);
        } catch (storageError) {
          console.error('[AI-ASSISTANT] ⚠️ Ошибка работы с хранилищем диалогов:', storageError);
        }
      }
      
      const tutorialPattern = /туториал|tutorial|гид|руководство|помощь начать|начать работу|обучение|мастер/i;
      
      if (tutorialPattern.test(request.message)) {
        console.log('[AI-ASSISTANT] 🎯 Обнаружена команда туториала, запускаем пошаговый гид');
        
        return {
          response: '🎉 Добро пожаловать в интерактивный туториал по созданию SMM кампании!\n\nЯ проведу вас через весь процесс от создания кампании до анализа результатов. Каждый шаг включает практические действия.',
          success: true,
          interactive: {
            type: 'welcome-tutorial',
            tutorial: {
              currentStep: 0,
              totalSteps: 7,
              steps: [
                {
                  id: 'create-campaign',
                  title: 'Создание кампании',
                  description: 'Создадим новую кампанию на основе вашего сайта или темы',
                  action: 'Создать кампанию',
                  icon: 'target',
                  example: 'Создай кампанию для сайта https://example.com',
                  command: 'Создай кампанию для сайта https://your-website.com'
                },
                {
                  id: 'fill-questionnaire',
                  title: 'Заполнение бизнес-анкеты',
                  description: 'Автоматически заполним анкету с данными о вашем бизнесе',
                  action: 'Заполнить анкету',
                  icon: 'file-text',
                  example: 'Заполни анкету автоматически',
                  command: 'Заполни анкету автоматически'
                },
                {
                  id: 'generate-keywords',
                  title: 'Генерация ключевых слов',
                  description: 'Найдем релевантные ключевые слова для вашей ниши',
                  action: 'Найти ключевые слова',
                  icon: 'trending-up',
                  example: 'Найди ключевые слова для моего сайта',
                  command: 'Найди ключевые слова для кампании'
                },
                {
                  id: 'collect-trends',
                  title: 'Сбор трендов',
                  description: 'Соберем актуальные тренды из социальных сетей',
                  action: 'Собрать тренды',
                  icon: 'trending-up',
                  example: 'Собери тренды для VK и Telegram',
                  command: 'Собери тренды для кампании'
                },
                {
                  id: 'create-content',
                  title: 'Создание контента',
                  description: 'Сгенерируем посты на основе трендов и ключевых слов',
                  action: 'Создать посты',
                  icon: 'image',
                  example: 'Создай 3 поста с картинками',
                  command: 'Создай 5 постов с картинками для кампании'
                },
                {
                  id: 'schedule-posts',
                  title: 'Планирование публикаций',
                  description: 'Запланируем автоматическую публикацию постов',
                  action: 'Запланировать',
                  icon: 'calendar',
                  example: 'Запланируй посты на завтра в Instagram',
                  command: 'Запланируй посты в социальные сети'
                },
                {
                  id: 'analyze-results',
                  title: 'Анализ результатов',
                  description: 'Просмотрим аналитику и эффективность кампании',
                  action: 'Посмотреть аналитику',
                  icon: 'trending-up',
                  example: 'Покажи аналитику кампании',
                  command: 'Покажи аналитику и результаты кампании'
                }
              ]
            }
          }
        };
      }
      
      const createCampaignPattern = /создай.*кампани|новую.*кампани|создать.*кампани/i;
      const hasWebsiteUrl = /https?:\/\/[^\s]+/;
      
      if (createCampaignPattern.test(request.message) && hasWebsiteUrl.test(request.message)) {
        console.log('[AI-ASSISTANT] ✅ Обнаружена команда создания кампании с URL, показываем интерактивные чекбоксы');
        
        const urlMatch = request.message.match(/(https?:\/\/[^\s]+)/);
        const websiteUrl = urlMatch ? urlMatch[1] : '';
        
        const nameMatch = request.message.match(/кампани[юию]\s+["""«]?([^"""«\n]+?)["""«]?(\s+для\s+сайта|\s+https?:\/\/|$)/i);
        let campaignName = nameMatch ? nameMatch[1].trim() : '';
        
        // Remove trailing "для сайта" if it was caught by mistake
        campaignName = campaignName.replace(/\s+для\s+сайта$/i, '').trim();
        
        if (!campaignName || campaignName.toLowerCase() === 'для сайта' || campaignName.toLowerCase() === 'новую') {
          try {
            const domain = new URL(websiteUrl).hostname.replace('www.', '');
            campaignName = `Кампания для ${domain}`;
          } catch {
            campaignName = 'Новая кампания';
          }
        }
        
        return {
          response: `Настройте опции для создания кампании "${campaignName}":`,
          success: true,
          interactive: {
            type: 'campaign-options',
            campaignOptions: {
              name: campaignName,
              description: `Кампания на основе сайта ${websiteUrl}`,
              websiteUrl: websiteUrl,
              options: [
                {
                  id: 'website-analysis',
                  name: 'Анализ сайта и заполнение анкеты',
                  description: 'Автоматически проанализировать сайт и заполнить бизнес-анкету',
                  enabled: true
                },
                {
                  id: 'keywords',
                  name: 'Найти ключевые слова под сайт',
                  description: 'Извлечь и сгенерировать ключевые слова на основе контента сайта',
                  enabled: true
                },
                {
                  id: 'find-sources',
                  name: 'Найти источники для поиска трендов',
                  description: 'Определить релевантные социальные сети и источники для анализа трендов',
                  enabled: true
                },
                {
                  id: 'collect-trends',
                  name: 'Найти тренды',
                  description: 'Собрать актуальные тренды из выбранных источников',
                  enabled: true
                },
                {
                  id: 'content-plan',
                  name: 'Создать контент план с картинками',
                  description: 'Сгенерировать контент план на основе трендов и ключевых слов с изображениями',
                  enabled: true
                }
              ]
            }
          }
        };
      }
      
      try {
        console.log('[AI-ASSISTANT] 🧠 Gemini анализирует команду и принимает решения...');
        const aiResponse = await handleAutonomousAIWithAPI(request);
        
        if (userId && aiResponse.response) {
          try {
            await aiConversationStorage.saveMessage({
              user_id: userId,
              chat_id: undefined,
              campaign_id: request.campaignId,
              role: 'assistant',
              content: aiResponse.response,
              timestamp: new Date(),
              metadata: aiResponse.data ? { tools: aiResponse.data } : undefined
            });
          } catch (saveError) {
            console.error('[AI-ASSISTANT] ⚠️ Не удалось сохранить ответ AI:', saveError);
          }
        }
        
        return aiResponse;
      } catch (autonomousError) {
        console.error('[AI-ASSISTANT] ⚠️ Ошибка автономной системы, переключение на fallback:', autonomousError);
        
        console.log('[AI-ASSISTANT] 🔄 Fallback: используем старый анализ команд');
        
        const commandAnalysis = await aiRoutingAnalyzeCommand(request.message, this.availableFunctions);
        console.log('[AI-ASSISTANT] Анализ команды (fallback):', commandAnalysis);

        switch (commandAnalysis.intent) {
        case 'fill_questionnaire':
          return await handleFillQuestionnaire(request);
        
        case 'read_questionnaire':
          return await handleReadQuestionnaire(request);
        
        case 'create_posts_from_questionnaire':
          return await handleCreatePostsFromQuestionnaire(request, commandAnalysis.parameters);
        
        case 'get_campaign_data':
          return await handleGetCampaignData(request, commandAnalysis.parameters);
        
        case 'manage_content':
          return await handleManageContent(request, commandAnalysis.parameters);
        
        case 'create_posts':
          return await handleCreatePosts(request, commandAnalysis.parameters);
        
        case 'schedule_posts':
          return await handleSchedulePosts(request, commandAnalysis.parameters);
        
        case 'publish_content':
          return await handlePublishContent(request, commandAnalysis.parameters);
        
        case 'analyze_campaign':
          return await handleAnalyzeCampaign(request, commandAnalysis.parameters);
        
        case 'create_stories':
          return await handleCreateStories(request, commandAnalysis.parameters);
        
        case 'get_analytics':
          return await handleGetAnalytics(request, commandAnalysis.parameters);
        
        case 'setup_social_accounts':
          return await handleSetupSocialAccounts(request, commandAnalysis.parameters);
        
        case 'optimize_content':
          return await handleOptimizeContent(request, commandAnalysis.parameters);
        
        case 'analyze_trends':
          return await handleAnalyzeTrends(request, commandAnalysis.parameters);
        
        case 'start_scheduler':
          return await handleStartScheduler(request, commandAnalysis.parameters);
        
        case 'stop_scheduler':
          return await handleStopScheduler(request, commandAnalysis.parameters);
        
        case 'create_campaign':
          return await handleCreateCampaign(request, commandAnalysis.parameters);
        
        case 'analyze_competitors':
          return await handleAnalyzeCompetitors(request, commandAnalysis.parameters);
        
        case 'generate_hashtags':
          return await handleGenerateHashtags(request, commandAnalysis.parameters);
        
        case 'schedule_optimal_time':
          return await handleScheduleOptimalTime(request, commandAnalysis.parameters);
        
        case 'collect_trends':
          return await handleCollectTrends(request, commandAnalysis.parameters);
        
        case 'help':
          return await handleHelp();
        
        default:
          return await handleUnknownCommand(request);
        }
      }
    } catch (error) {
      console.error('[AI-ASSISTANT] Ошибка при обработке команды:', error);
      return {
        response: 'Извините, произошла ошибка при обработке вашей команды. Попробуйте переформулировать запрос.',
        success: false
      };
    }
  }
}

export const aiAssistantService = new AIAssistantService();
