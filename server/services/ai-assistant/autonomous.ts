import { AIAssistantRequest, AIAssistantResponse } from './types';
import { geminiVertexDirect } from '../gemini-vertex-direct';
import { directusCrud } from '../directus-crud';
import { AutonomousAI } from '../autonomous-ai';
import axios from 'axios';

const autonomousAI = new AutonomousAI();

export async function handleAutonomousAIWithAPI(request: AIAssistantRequest): Promise<AIAssistantResponse> {
  try {
    console.log('[AI-ASSISTANT] 🚀 Переключение на автономную AI-систему с Function Calling');
    console.log('[AI-ASSISTANT] 🧠 Gemini будет сам понимать намерения и принимать решения');

    const autonomousRequest = {
      userId: request.userId,
      campaignId: request.campaignId || '',
      authToken: request.authToken || request.userToken || '',
      message: request.message,
      chatHistory: request.chatHistory || []
    };

    const result = await autonomousAI.processCommand(autonomousRequest);
    
    return {
      response: result.response,
      success: result.success,
      action: 'Автономная AI с Function Calling',
      data: result.data
    };
    
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка автономной системы:', error);
    return {
      response: 'Произошла ошибка при обработке команды через автономную AI-систему. Попробуйте переформулировать запрос.',
      success: false
    };
  }
}

export async function executeStepwiseWorkflow(aiPlan: any, request: AIAssistantRequest): Promise<any> {
  console.log('[AI-ASSISTANT] Запуск пошагового workflow');
  
  const stepResults: any[] = [];
  let workflowContext: any = {};
  let overallSuccess = true;
  const errors: string[] = [];
  
  if (!aiPlan.api_calls || aiPlan.api_calls.length === 0) {
    return {
      response: aiPlan.user_response || 'Задача выполнена без API вызовов.',
      success: true,
      data: { plan: aiPlan.plan }
    };
  }
  
  for (let i = 0; i < aiPlan.api_calls.length; i++) {
    const apiCall = aiPlan.api_calls[i];
    console.log(`[AI-ASSISTANT] Выполняем шаг ${i + 1}/${aiPlan.api_calls.length}: ${apiCall.method} ${apiCall.endpoint}`);
    
    try {
      const adaptedApiCall = await adaptAPICallWithContext(apiCall, workflowContext, request);
      const result = await executeAPICall(adaptedApiCall, request);
      
      if (result && result.success !== false && !result.error && !result.blocked_endpoint) {
        console.log(`[AI-ASSISTANT] Шаг ${i + 1} выполнен успешно`);
        stepResults.push({ step: i + 1, success: true, result });
        
        if (result.data) {
          workflowContext[`step_${i + 1}_data`] = result.data;
          if (apiCall.endpoint?.includes('/website-analysis')) {
            workflowContext.websiteAnalysis = result.data;
            if (apiCall.body?.url) {
              workflowContext.websiteUrl = apiCall.body.url;
            }
          } else if (apiCall.endpoint === '/api/campaigns' && apiCall.method === 'POST') {
            workflowContext.newCampaign = result.data;
          }
        }
      } else {
        const retryResult = await handleStepError(apiCall, result, workflowContext, request);
        if (retryResult.success) {
          console.log(`[AI-ASSISTANT] Шаг ${i + 1} исправлен через retry`);
          stepResults.push({ step: i + 1, success: true, result: retryResult.result, retried: true });
          if (retryResult.result?.data) {
            workflowContext[`step_${i + 1}_data`] = retryResult.result.data;
          }
        } else {
          overallSuccess = false;
          const errorMsg = `Шаг ${i + 1}: ${retryResult.error || 'неизвестная ошибка'}`;
          errors.push(errorMsg);
          stepResults.push({ step: i + 1, success: false, error: errorMsg });
          console.error(`[AI-ASSISTANT] ${errorMsg}`);
        }
      }
    } catch (error: any) {
      overallSuccess = false;
      const errorMsg = `Шаг ${i + 1}: ${error?.message || 'критическая ошибка'}`;
      errors.push(errorMsg);
      stepResults.push({ step: i + 1, success: false, error: errorMsg });
      console.error(`[AI-ASSISTANT] ${errorMsg}`, error);
    }
  }
  
  let finalResponse: string;
  if (overallSuccess) {
    finalResponse = aiPlan.user_response || 'Все задачи выполнены успешно!';
    
    if (workflowContext.websiteAnalysis || workflowContext.keywords || stepResults.some(s => s.result?.data)) {
      finalResponse += '\n\n## 📊 **ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ:**\n';
      
      stepResults.forEach((step, index) => {
        if (step.success && step.result?.data) {
          finalResponse += `\n### 🔹 **Шаг ${step.step}:**\n`;
          
          if (step.result.data.keywords) {
            const keywords = step.result.data.keywords;
            finalResponse += `✅ **Найдено ключевых слов:** ${keywords.length}\n\n`;
            
            const topKeywords = keywords.slice(0, 10);
            topKeywords.forEach((kw: any, i: number) => {
              finalResponse += `${i + 1}. **${kw.keyword}** (${kw.relevance}%)\n`;
            });
            
            if (keywords.length > 10) {
              finalResponse += `\n... и еще ${keywords.length - 10} ключевых слов\n`;
            }
          }
          
          if (step.result.data.companyName) {
            finalResponse += `✅ **Компания:** ${step.result.data.companyName}\n`;
            finalResponse += `✅ **Описание:** ${step.result.data.businessDescription?.substring(0, 150)}...\n`;
            finalResponse += `✅ **Целевая аудитория:** ${step.result.data.targetAudience?.substring(0, 100)}...\n`;
          }
          
          if (step.result.data.trends) {
            finalResponse += `✅ **Найдено трендов:** ${step.result.data.trends.length}\n`;
          }
          
          if (step.result.data.content) {
            finalResponse += `✅ **Сгенерировано контента:** ${step.result.data.content.length} постов\n`;
          }
        }
      });
    }
    
    finalResponse += `\n\n✅ **Выполнено:** ${stepResults.length} операций успешно.`;
  } else {
    finalResponse = `⚠️ Выполнение завершено с ошибками:\n${errors.join('\n')}`;
    const successfulSteps = stepResults.filter(s => s.success).length;
    if (successfulSteps > 0) {
      finalResponse += `\n\n✅ Успешно: ${successfulSteps}/${stepResults.length} операций.`;
    }
  }
  
  return {
    response: finalResponse,
    success: overallSuccess,
    data: { 
      plan: aiPlan.plan,
      workflow_context: workflowContext,
      step_results: stepResults,
      errors: errors
    }
  };
}

export async function adaptAPICallWithContext(apiCall: any, context: any, request: AIAssistantRequest): Promise<any> {
  const adapted = { ...apiCall };
  
  if (adapted.endpoint) {
    if (adapted.endpoint.includes('{NEW_CAMPAIGN_ID}') && context.step_2_data?.id) {
      adapted.endpoint = adapted.endpoint.replace(/\{NEW_CAMPAIGN_ID\}/g, context.step_2_data.id);
      console.log('[AI-ASSISTANT] Заменен плейсхолдер NEW_CAMPAIGN_ID на:', context.step_2_data.id);
    }
    if (adapted.endpoint.includes('{CAMPAIGN_ID}') && context.step_2_data?.id) {
      adapted.endpoint = adapted.endpoint.replace(/\{CAMPAIGN_ID\}/g, context.step_2_data.id);
    }
  }
  
  if (adapted.body && context.step_2_data?.id) {
    if (adapted.body.campaignId === '{NEW_CAMPAIGN_ID}') {
      adapted.body.campaignId = context.step_2_data.id;
      console.log('[AI-ASSISTANT] Заменен campaignId в body на:', context.step_2_data.id);
    }
    if (adapted.body.campaignId === '{CAMPAIGN_ID}') {
      adapted.body.campaignId = context.step_2_data.id;
    }
  }
  
  if (apiCall.endpoint?.includes('/campaigns') && apiCall.method === 'POST' && context.websiteAnalysis) {
    console.log('[AI-ASSISTANT] Адаптируем создание кампании с данными анализа сайта');
    const analysis = context.websiteAnalysis;
    
    const relevantDescription = `SMM кампания для ${analysis.companyName || 'компании'}. ${analysis.businessDescription || ''} Целевая аудитория: ${analysis.targetAudience || 'широкая аудитория'}.`.trim();
    
    const websiteUrl = context.websiteUrl || context.step_1_data?.url || analysis.websiteUrl || null;
    
    adapted.body = {
      ...adapted.body,
      description: relevantDescription,
      link: websiteUrl
    };
    
    console.log('[AI-ASSISTANT] Добавлено релевантное описание и URL кампании:', relevantDescription, '| URL:', websiteUrl);
  }
  
  if (apiCall.endpoint?.includes('/questionnaire') && context.newCampaign?.id) {
    const newCampaignId = context.newCampaign.id;
    adapted.endpoint = apiCall.endpoint.replace(/\/campaigns\/[^\/]+\//, `/campaigns/${newCampaignId}/`);
    console.log('[AI-ASSISTANT] Обновлен endpoint анкеты для новой кампании:', adapted.endpoint);
    
    if (context.websiteAnalysis && (apiCall.method === 'POST' || apiCall.method === 'PATCH')) {
      const analysis = context.websiteAnalysis;
      adapted.body = {
        companyName: analysis.companyName,
        businessDescription: analysis.businessDescription,
        targetAudience: analysis.targetAudience,
        mainDirections: analysis.mainDirections,
        brandImage: analysis.brandImage,
        productsServices: analysis.productsServices,
        customerResults: analysis.customerResults,
        companyFeatures: analysis.companyFeatures,
        businessValues: analysis.businessValues,
        productBeliefs: analysis.productBeliefs,
        competitiveAdvantages: analysis.competitiveAdvantages,
        marketingExpectations: analysis.marketingExpectations,
        contactInfo: analysis.contactInfo
      };
      console.log('[AI-ASSISTANT] Заполнена анкета данными из анализа сайта:', Object.keys(adapted.body));
    }
  }
  
  return adapted;
}

export async function handleStepError(apiCall: any, result: any, context: any, request: AIAssistantRequest): Promise<any> {
  if (apiCall.endpoint?.includes('/questionnaire') && 
      apiCall.method === 'PATCH' && 
      (result?.status === 404 || result?.error?.includes('404'))) {
    
    console.log('[AI-ASSISTANT] Обнаружена ошибка 404 для анкеты, переключаемся на POST (создание)');
    
    const postCall = await adaptAPICallWithContext({
      ...apiCall,
      method: 'POST'
    }, context, request);
    
    try {
      const postResult = await executeAPICall(postCall, request);
      if (postResult && postResult.success !== false && !postResult.error) {
        return { success: true, result: postResult };
      } else {
        return { success: false, error: `POST также не удался: ${postResult?.error || 'неизвестная ошибка'}` };
      }
    } catch (postError: any) {
      return { success: false, error: `POST ошибка: ${postError?.message || 'критическая ошибка'}` };
    }
  }
  
  if (apiCall.endpoint?.includes('/questionnaire') && 
      apiCall.method === 'POST' && 
      (result?.status === 400 || result?.error?.includes('400'))) {
    
    console.log('[AI-ASSISTANT] Обнаружена ошибка 400 для анкеты, переключаемся на PATCH (обновление)');
    
    const patchCall = await adaptAPICallWithContext({
      ...apiCall,
      method: 'PATCH'
    }, context, request);
    
    try {
      const patchResult = await executeAPICall(patchCall, request);
      if (patchResult && patchResult.success !== false && !patchResult.error) {
        return { success: true, result: patchResult };
      } else {
        return { success: false, error: `PATCH также не удался: ${patchResult?.error || 'неизвестная ошибка'}` };
      }
    } catch (patchError: any) {
      return { success: false, error: `PATCH ошибка: ${patchError?.message || 'критическая ошибка'}` };
    }
  }
  
  return { 
    success: false, 
    error: result?.error || result?.blocked_endpoint || 'неопределенная ошибка' 
  };
}

export async function executeAPICall(apiCall: any, request: AIAssistantRequest): Promise<any> {
  let pathOnly = apiCall.endpoint;
  if (apiCall.endpoint?.startsWith('http://') || apiCall.endpoint?.startsWith('https://')) {
    try {
      const url = new URL(apiCall.endpoint);
      pathOnly = url.pathname;
    } catch (error) {
      pathOnly = apiCall.endpoint;
    }
  }

  const allowedEndpoints = [
    'GET /api/campaigns',
    'GET /api/campaign-content',
    'GET /api/campaigns/.*/questionnaire', 
    'POST /api/campaign-content',
    'POST /api/campaigns',
    'GET /api/keywords',
    'GET /api/trends',
    'GET /api/sources',
    'POST /api/ai/generate-content',
    'POST /api/website-analysis',
    'POST /api/campaigns/.*/questionnaire',
    'PATCH /api/campaigns/.*/questionnaire',
    'GET /api/campaigns/.*/questionnaire'
  ];

  const requestKey = `${apiCall.method?.toUpperCase()} ${pathOnly}`;
  
  const isAllowed = allowedEndpoints.some(pattern => {
    if (pattern.includes('.*')) {
      const regex = new RegExp('^' + pattern.replace(/\.\*/g, '[^/]+') + '$');
      return regex.test(requestKey);
    } else {
      return pattern === requestKey;
    }
  });
  
  if (!isAllowed) {
    console.warn(`[AI-ASSISTANT] Блокирован неразрешенный endpoint: ${requestKey}`);
    return {
      success: false,
      error: 'Endpoint не разрешен для автономного выполнения',
      blocked_endpoint: requestKey
    };
  }

  if (apiCall.endpoint && (apiCall.endpoint.startsWith('http://') || apiCall.endpoint.startsWith('https://'))) {
    try {
      const url = new URL(apiCall.endpoint);
      const isInternalAPI = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0';
      
      if (!isInternalAPI) {
        return {
          success: false,
          error: 'Внешние URL заблокированы по соображениям безопасности',
          message: 'Доступны только внутренние API endpoints'
        };
      }
      
      apiCall.endpoint = url.pathname + url.search;
    } catch (error) {
      return {
        success: false,
        error: 'Неверный формат URL',
        message: 'Не удалось обработать URL'
      };
    }
  }

  const baseURL = process.env.API_BASE_URL || 'http://localhost:5000';
  
  const headers = {
    'Authorization': `Bearer ${request.authToken}`,
    'Content-Type': 'application/json'
  };

  const config = {
    method: apiCall.method.toLowerCase(),
    url: `${baseURL}${apiCall.endpoint}`,
    headers,
    timeout: 60000,
    ...(apiCall.body && { data: apiCall.body })
  };

  console.log(`[AI-ASSISTANT] Выполняем безопасный API вызов: ${requestKey}`);
  
  try {
    const response = await axios(config);
    return response.data;
  } catch (error: any) {
    console.error(`[AI-ASSISTANT] Ошибка API вызова ${requestKey}:`, error.message);
    
    const status = error?.response?.status;
    
    return {
      success: false,
      error: error.message,
      status: status,
      endpoint: requestKey
    };
  }
}

export async function parseWebPage(url: string): Promise<any> {
  return {
    success: false,
    error: 'Веб-парсинг отключен по соображениям безопасности',
    message: 'Функция временно недоступна из-за SSRF уязвимостей'
  };
}

export async function handleAutonomousCommand(request: AIAssistantRequest): Promise<AIAssistantResponse> {
  try {
    console.log('[AUTONOMOUS-AI] Обработка команды:', request.message);
    
    if ((request as any).selectedPlatforms) {
      console.log('[AUTONOMOUS-AI] Получены выбранные платформы:', (request as any).selectedPlatforms);
      return await executeWithSelectedPlatforms(request, (request as any).selectedPlatforms);
    }

    if (request.message.toLowerCase().includes('собери тренды') || 
        request.message.toLowerCase().includes('подбери тренды')) {
      
      const campaignData = await directusCrud.list('user_campaigns', {
        authToken: request.authToken,
        filter: { id: { _eq: request.campaignId } },
        limit: 1
      });

      if (!campaignData?.[0]) {
        return {
          response: 'Кампания не найдена. Выберите кампанию и попробуйте снова.',
          success: false
        };
      }

      const socialSettings = (campaignData[0] as any).social_media_settings;
      
      const availablePlatforms = [
        { id: 'vk', name: 'ВКонтакте', enabled: socialSettings?.vk?.enabled || false },
        { id: 'telegram', name: 'Telegram', enabled: socialSettings?.telegram?.enabled || false },
        { id: 'instagram', name: 'Instagram', enabled: socialSettings?.instagram?.enabled || false },
        { id: 'facebook', name: 'Facebook', enabled: socialSettings?.facebook?.enabled || false },
        { id: 'youtube', name: 'YouTube', enabled: socialSettings?.youtube?.enabled || false }
      ];

      return {
        response: 'Для каких социальных сетей вы хотите собрать тренды?',
        success: true,
        interactive: {
          type: 'platform-selector',
          platforms: availablePlatforms
        }
      };
    }
    
    const planPrompt = `
Проанализируй команду пользователя и создай план действий для SMM-платформы.

КОМАНДА: "${request.message}"
КАМПАНИЯ: ${request.campaignId}

ДОСТУПНЫЕ ДЕЙСТВИЯ:
1. getCampaignData - получить данные кампании и анкеты
2. getKeywords - найти ключевые слова с сайта кампании  
3. collectTrends - запустить сбор трендов
4. getAnalytics - получить аналитику кампании

Создай пошаговый план в формате JSON:
{
  "plan": [
    {"action": "getCampaignData", "reason": "нужны данные кампании"},
    {"action": "getKeywords", "reason": "нужны ключевые слова"}
  ],
  "explanation": "Краткое объяснение плана"
}
`;

    const planResponse = await geminiVertexDirect.generateContent({
      prompt: planPrompt,
      model: 'gemini-3-pro-preview'
    });

    let plan;
    try {
      const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
        
        const validActions = ['getCampaignData', 'getKeywords', 'collectTrends', 'getAnalytics'];
        if (plan?.plan) {
          plan.plan = plan.plan.filter((step: any) => 
            step.action && validActions.includes(step.action)
          ).slice(0, 5);
        }
      } else {
        plan = null;
      }
    } catch (error) {
      console.error('[AUTONOMOUS-AI] Ошибка парсинга плана:', error);
      plan = null;
    }

    if (!plan?.plan || plan.plan.length === 0) {
      return {
        response: 'Не удалось создать план выполнения команды. Попробуйте переформулировать запрос.',
        success: false
      };
    }

    console.log('[AUTONOMOUS-AI] План:', plan);

    let detailedResponse = `🎯 **План выполнения команды "${request.message}"**\n\n`;
    detailedResponse += `📋 **Стратегия:** ${plan.explanation}\n\n`;
    detailedResponse += `📌 **Запланированные шаги:**\n`;
    
    plan.plan.forEach((step: any, index: number) => {
      detailedResponse += `${index + 1}. **${getActionName(step.action)}** - ${step.reason}\n`;
    });
    
    detailedResponse += `\n🚀 **Начинаю выполнение...**\n\n`;

    const results: any[] = [];
    for (let i = 0; i < plan.plan.length; i++) {
      const step = plan.plan[i];
      const stepNumber = i + 1;
      
      console.log(`[AUTONOMOUS-AI] Выполняем шаг ${stepNumber}: ${step.action}`);
      
      detailedResponse += `⏳ **Шаг ${stepNumber}/${plan.plan.length}: ${getActionName(step.action)}**\n`;
      detailedResponse += `📝 ${step.reason}\n`;
      
      const result = await executeAutonomousAction(step.action, request);
      results.push({ action: step.action, result, reason: step.reason });
      
      if (result.success) {
        detailedResponse += `✅ **Выполнено успешно!** `;
        detailedResponse += getSuccessMessage(step.action, result.data) + `\n\n`;
      } else {
        detailedResponse += `❌ **Ошибка:** ${result.error || 'Неизвестная ошибка'}\n\n`;
      }
    }

    const successCount = results.filter(r => r.result.success).length;
    const totalSteps = results.length;
    
    detailedResponse += `📊 **Результат выполнения:**\n`;
    detailedResponse += `✅ Успешно: ${successCount}/${totalSteps} шагов\n`;
    
    if (successCount === totalSteps) {
      detailedResponse += `🎉 **Все задачи выполнены успешно!**\n\n`;
      
      const summaryPrompt = `
Создай краткое резюме выполненной работы для пользователя:

КОМАНДА: "${request.message}"
ВЫПОЛНЕННЫЕ ДЕЙСТВИЯ:
${results.map((r, i) => `${i+1}. ${r.action}: ${r.result.success ? 'Успешно' : 'Ошибка'} - ${r.reason}`).join('\n')}

ДАННЫЕ:
${results.map(r => r.result.data ? JSON.stringify(r.result.data, null, 2) : 'Нет данных').join('\n---\n')}

Создай короткое (2-3 предложения) резюме того, что было сделано и какие результаты получены.
`;

      const summaryResponse = await geminiVertexDirect.generateContent({
        prompt: summaryPrompt,
        model: 'gemini-3-pro-preview'
      });
      
      detailedResponse += `💡 **Резюме:** ${summaryResponse}\n`;
    } else {
      detailedResponse += `⚠️ Некоторые шаги завершились с ошибками. Проверьте настройки кампании и повторите попытку.\n`;
    }

    return {
      response: detailedResponse,
      success: results.every(r => r.result.success),
      data: { plan, results }
    };

  } catch (error) {
    console.error('[AUTONOMOUS-AI] Ошибка:', error);
    return {
      response: 'Произошла ошибка при автономной обработке команды.',
      success: false
    };
  }
}

export async function executeAutonomousAction(action: string, request: AIAssistantRequest): Promise<any> {
  try {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';

    switch (action) {
      case 'getCampaignData':
        const campaigns = await directusCrud.list('user_campaigns', {
          authToken: request.authToken,
          filter: { id: { _eq: request.campaignId } },
          limit: 1
        });
        return { success: !!campaigns?.length, data: campaigns?.[0] };

      case 'getKeywords':
        const campaign = await directusCrud.list('user_campaigns', {
          authToken: request.authToken,
          filter: { id: { _eq: request.campaignId } },
          limit: 1
        });
        
        if (!campaign?.[0]) {
          return { success: false, error: 'Кампания не найдена' };
        }

        const websiteUrl = (campaign[0] as any).link || (campaign[0] as any).website;
        if (!websiteUrl) {
          return { success: false, error: 'URL сайта не указан в кампании' };
        }

        const keywordResponse = await fetch(`${baseUrl}/api/keywords/analyze-website`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.authToken}`
          },
          body: JSON.stringify({ url: websiteUrl })
        });
        
        const keywordData = await keywordResponse.json();
        return { success: keywordResponse.ok, data: keywordData };

      case 'collectTrends':
        const campaignForTrends = await directusCrud.list('user_campaigns', {
          authToken: request.authToken,
          filter: { id: { _eq: request.campaignId } },
          limit: 1
        });
        
        if (!campaignForTrends?.[0]) {
          return { success: false, error: 'Кампания не найдена для сбора трендов' };
        }

        const socialSettings = (campaignForTrends[0] as any).social_media_settings;
        
        const availablePlatforms: string[] = [];
        if (socialSettings?.vk?.enabled) availablePlatforms.push('vk');
        if (socialSettings?.telegram?.enabled) availablePlatforms.push('telegram');
        if (socialSettings?.facebook?.enabled) availablePlatforms.push('facebook');
        if (socialSettings?.instagram?.enabled) availablePlatforms.push('instagram');
        if (socialSettings?.youtube?.enabled) availablePlatforms.push('youtube');

        const platforms = availablePlatforms.length > 0 ? availablePlatforms : ['vk', 'telegram'];
        
        console.log(`[AUTONOMOUS-AI] Собираем тренды для платформ: ${platforms.join(', ')}`);

        const trendsResponse = await fetch(`${baseUrl}/api/trends/collect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.authToken}`
          },
          body: JSON.stringify({ 
            campaignId: request.campaignId,
            platforms: platforms,
            collectSources: 1,
            collectComments: [],
            minFollowers: {
              instagram: 5000,
              telegram: 2000,
              vk: 3000,
              facebook: 5000,
              youtube: 10000
            },
            maxSourcesPerPlatform: 10,
            maxTrendsPerSource: 5,
            day_past: 7,
            language: "ru",
            filters: {
              minReactions: 10,
              minViews: 500,
              contentTypes: ["text", "image", "video"]
            }
          })
        });
        
        const trendsData = await trendsResponse.json();
        return { 
          success: trendsResponse.ok, 
          data: { 
            message: trendsData?.message || 'Сбор трендов запущен',
            platforms: platforms,
            collectSources: true
          }
        };

      case 'getAnalytics':
        const content = await directusCrud.list('campaign_content', {
          authToken: request.authToken,
          filter: { campaign_id: { _eq: request.campaignId } },
          limit: -1
        });
        
        return { 
          success: true, 
          data: { 
            contentCount: content?.length || 0,
            lastUpdate: (content?.[0] as any)?.date_created 
          }
        };

      default:
        return { success: false, error: `Неизвестное действие: ${action}` };
    }
  } catch (error) {
    return { success: false, error: `Ошибка выполнения ${action}: ${error}` };
  }
}

export function getActionName(action: string): string {
  const actionNames: { [key: string]: string } = {
    'getCampaignData': 'Получение данных кампании',
    'getKeywords': 'Анализ ключевых слов',
    'collectTrends': 'Сбор трендов',
    'getAnalytics': 'Получение аналитики',
    'createContent': 'Создание контента'
  };
  return actionNames[action] || action;
}

export function getSuccessMessage(action: string, data: any): string {
  switch (action) {
    case 'getCampaignData':
      return `Данные кампании загружены. Название: "${data?.name || 'Без названия'}"`;
    case 'getKeywords':
      return `Найдено ${data?.keywords?.length || 0} ключевых слов с сайта кампании`;
    case 'collectTrends':
      const platformsList = data?.platforms ? data.platforms.join(', ') : 'неизвестно';
      return `Запущен сбор трендов для платформ: ${platformsList}. ${data?.collectSources ? 'Источники включены.' : ''} Статус: ${data?.message || 'В процессе'}`;
    case 'getAnalytics':
      return `Получена аналитика: ${data?.contentCount || 0} постов, последнее обновление: ${data?.lastUpdate ? new Date(data.lastUpdate).toLocaleDateString('ru-RU') : 'нет данных'}`;
    default:
      return 'Операция завершена';
  }
}

export function shouldUseAutonomousAI(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  const autonomousKeywords = [
    'собери тренды',
    'подбери ключевые слова',
    'найди ключевые слова',
    'покажи ключевые слова',
    'добавь ключевые слова',
    'сохрани ключевые слова',
    'ключевые слова кампании',
    'генерируй ключевые слова',
    'сгенерируй ключевые слова',
    'проанализируй кампанию',
    'покажи аналитику',
    'создай контент на основе',
    'сделай полный анализ',
    'автоматически',
    'умно',
    'сам реши',
    'лучший способ',
    'прочитай анкету и',
    'на основе анкеты',
    'серию постов',
    'полный цикл',
    'всё сразу',
    'комплексно',
    'разбери сайт',
    'парси страницу',
    'изучи сайт',
    'проанализируй сайт',
    'https://',
    'http://'
  ];
  
  return autonomousKeywords.some(keyword => lowerMessage.includes(keyword));
}

export async function executeWithSelectedPlatforms(request: AIAssistantRequest, selectedPlatforms: string[]): Promise<AIAssistantResponse> {
  try {
    console.log(`[AUTONOMOUS-AI] Выполняем сбор трендов для выбранных платформ: ${selectedPlatforms.join(', ')}`);

    const allowedPlatforms = ['vk', 'telegram', 'instagram', 'facebook', 'youtube'];
    const validPlatforms = selectedPlatforms.filter(p => allowedPlatforms.includes(p));
    
    if (validPlatforms.length === 0) {
      return {
        response: '❌ Не выбрано ни одной допустимой платформы для сбора трендов.',
        success: false
      };
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';

    const trendsResponse = await fetch(`${baseUrl}/api/trends/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.authToken}`
      },
      body: JSON.stringify({ 
        campaignId: request.campaignId,
        platforms: validPlatforms,
        collectSources: 1,
        collectComments: [],
        minFollowers: {
          instagram: 5000,
          telegram: 2000,
          vk: 3000,
          facebook: 5000,
          youtube: 10000
        },
        maxSourcesPerPlatform: 10,
        maxTrendsPerSource: 5,
        day_past: 7,
        language: "ru",
        filters: {
          minReactions: 10,
          minViews: 500,
          contentTypes: ["text", "image", "video"]
        }
      })
    });

    const trendsData = await trendsResponse.json();
    
    if (trendsResponse.ok) {
      return {
        response: `🚀 **Сбор трендов запущен!**\n\n📊 **Выбранные платформы:** ${validPlatforms.join(', ')}\n\n✅ **Статус:** ${trendsData?.message || 'В процессе обработки'}\n\n💡 Процесс может занять несколько минут. Результаты появятся в разделе "Тренды".`,
        success: true,
        action: 'Сбор трендов запущен для выбранных платформ',
        data: { platforms: validPlatforms, message: trendsData?.message }
      };
    } else {
      return {
        response: `❌ **Ошибка при запуске сбора трендов**\n\n${trendsData?.message || 'Неизвестная ошибка'}`,
        success: false
      };
    }

  } catch (error) {
    console.error('[AUTONOMOUS-AI] Ошибка выполнения с выбранными платформами:', error);
    return {
      response: 'Произошла ошибка при запуске сбора трендов. Попробуйте еще раз.',
      success: false
    };
  }
}

export function generateAPIDocumentation(): string {
  const documentation = `
ВАЖНЫЕ ENDPOINT'Ы ДЛЯ КЛЮЧЕВЫХ СЛОВ:
• POST /api/keywords/analyze-website - Генерация ключевых слов с сайта (ОСНОВНОЙ для ключевых слов!)
• POST /api/website-analysis - Анализ сайта для заполнения бизнес-анкеты (НЕ для ключевых слов!)

БАЗОВАЯ ИНФОРМАЦИЯ:
- Сервер: http://localhost:5000 (development)
- Авторизация: Bearer JWT токен в заголовке Authorization
- Формат ответов: JSON с полями success, data, error, meta

ОСНОВНЫЕ КАТЕГОРИИ API:

1. АУТЕНТИФИКАЦИЯ (/api/auth/*)
   - POST /api/auth/login - Вход в систему
   - GET /api/auth/me - Информация о текущем пользователе
   - POST /api/auth/refresh - Обновление токена

2. КАМПАНИИ (безопасные операции)
   - GET /api/campaigns - Список кампаний пользователя

3. КОНТЕНТ (безопасные операции)
   - GET /api/campaign-content?campaignId={id} - Контент кампании
   - POST /api/campaign-content - Создание нового контента

4. БИЗНЕС-АНКЕТЫ (безопасные операции)
   - GET /api/business-questionnaire?campaignId={id} - Получение анкеты (legacy)
   - GET /api/campaigns/{campaignId}/questionnaire - Получение анкеты кампании
   - POST /api/campaigns/{campaignId}/questionnaire - Создание анкеты для кампании
   - PATCH /api/campaigns/{campaignId}/questionnaire - Обновление анкеты

5. AI ГЕНЕРАЦИЯ (безопасные операции)
   - POST /api/ai/generate-content - Генерация текста через Gemini

6. АНАЛИЗ ВЕБ-САЙТОВ (безопасные операции)
   - POST /api/website-analysis - Анализ веб-сайта по URL

ПРАВИЛЬНЫЙ WORKFLOW ДЛЯ СОЗДАНИЯ НОВОЙ КАМПАНИИ:
1. POST /api/website-analysis - Проанализировать сайт и получить данные о бизнесе
2. POST /api/campaigns - Создать кампанию с названием и РЕЛЕВАНТНЫМ ОПИСАНИЕМ на основе анализа
3. POST /api/campaigns/{newCampaignId}/questionnaire - Создать НОВУЮ анкету для новой кампании
4. POST /api/ai/generate-content - Создать контент на основе анкеты

ВАЖНО: Для НОВЫХ кампаний всегда используйте POST для создания анкеты!
Только если анкета уже существует (ошибка 400), используйте PATCH для обновления!

ВАЖНЫЕ ПАРАМЕТРЫ:
- campaignId: UUID активной кампании (обязателен для большинства операций)
- userId: UUID пользователя (автоматически из токена)
- authToken: JWT токен авторизации

ТИПОВЫЕ СТРУКТУРЫ ДАННЫХ:
- Контент: {title, content, content_type, status, keywords, hashtags, image_url}
- Кампания: {name, description, keywords, platforms, settings}
- Анкета: {company_name, business_description, target_audience, customer_pain_points}
`;

  return documentation;
}
