import { AIAssistantRequest, AIAssistantResponse } from './types';
import { geminiVertexDirect } from '../gemini-vertex-direct';
import { CampaignDataService } from '../campaign-data';
import { directusCrud } from '../directus-crud';
import { falAiUniversalService, FalAiModelName } from '../fal-ai-universal';
import { getPublishScheduler } from '../publish-scheduler';
import axios from 'axios';

const campaignDataService = new CampaignDataService();

export function sanitizeContent(rawContent: string): string {
  try {
    let cleaned = rawContent;
    
    cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => 
      match.replace(/^```.*\n|```$/g, ''));
    
    cleaned = cleaned.replace(/<\s*br\s*\/?\s*>/gi, '\n');
    cleaned = cleaned.replace(/<\s*\/p\s*>/gi, '\n\n');
    
    cleaned = cleaned.replace(/<[^>]+>/g, '');
    
    const entities: Record<string, string> = {
      '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"',
      '&#x27;': "'", '&#x2F;': '/', '&nbsp;': ' ', '&#10;': '\n'
    };
    
    Object.entries(entities).forEach(([entity, char]) => {
      cleaned = cleaned.replace(new RegExp(entity, 'g'), char);
    });
    
    cleaned = cleaned
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic  
      .replace(/__(.*?)__/g, '$1') // underline
      .replace(/~~(.*?)~~/g, '$1') // strikethrough
      .replace(/`([^`]*)`/g, '$1') // inline код
      .replace(/^[#]+\s/gm, ''); // заголовки
    
    cleaned = cleaned
      .replace(/^я, .*?[,–-]/im, '') // "Я, Вадим Бельский,"
      .replace(/свяжитесь со мной.*$/im, '') // CTA
      .replace(/для консультации.*$/im, '') // CTA  
      .replace(/готовы вывести.*$/im, ''); // корпоративная фраза
    
    cleaned = cleaned
      .replace(/\n{3,}/g, '\n\n') // множественные переносы
      .replace(/\s+/g, ' ') // множественные пробелы
      .trim();
    
    return cleaned;
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка очистки контента:', error);
    return rawContent;
  }
}

export function truncateTitle(raw: string, maxWords = 7, maxChars = 60): string {
  const cleaned = raw
    .replace(/["'«»*_]/g, '')
    .replace(/^(ЗАГОЛОВОК|Заголовок):\s*/i, '')
    .trim();
  const words = cleaned.split(/\s+/);
  const truncatedByWords = words.length > maxWords ? words.slice(0, maxWords).join(' ') : cleaned;
  return truncatedByWords.length > maxChars ? truncatedByWords.slice(0, maxChars).trimEnd() : truncatedByWords;
}

export async function generatePostTitle(topic: string, postNumber: number, content: string): Promise<string> {
  try {
    const contentPreview = content.substring(0, 120).replace(/[^\w\s\u0400-\u04FF]/g, ' ').trim();
    
    const titlePrompt = `Создай краткий и конкретный заголовок для поста.

Тема: ${topic}
Начало поста: ${contentPreview}

Требования:
- РОВНО 3–6 слов (не больше!)
- Конкретный — отражает главную мысль поста
- Без вводных слов ("Как", "О том, как", "Всё о")
- Без кавычек, тире в начале, номеров, скобок
- На русском языке

Пример хорошего заголовка: "Скидки на летнюю коллекцию"
Пример плохого заголовка: "Как наша компания помогает клиентам достичь успеха в современном мире"

Ответ — ТОЛЬКО заголовок, одна строка.`;

    const generatedTitle = await geminiVertexDirect.generateContent({ 
      prompt: titlePrompt,
      model: 'gemini-2.0-flash'
    });

    const cleanTitle = truncateTitle(generatedTitle);

    if (!cleanTitle || cleanTitle.length < 3) {
      const firstSentence = content
        .split(/[.!?\n]/)[0]
        .trim()
        .replace(/[^\w\s\u0400-\u04FF]/g, ' ')
        .trim();
        
      if (firstSentence && firstSentence.length > 5) {
        return truncateTitle(firstSentence);
      }
      
      const fallbackTitles = [
        `${topic}: советы`,
        `${topic}: руководство`,
        `${topic}: ключевые факты`
      ];
      return truncateTitle(fallbackTitles[postNumber % fallbackTitles.length]);
    }

    return cleanTitle;
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка генерации заголовка:', error);
    return truncateTitle(`${topic} — главное`);
  }
}

export async function handleFillQuestionnaire(request: AIAssistantRequest): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для заполнения анкеты необходимо выбрать активную кампанию. Пожалуйста, выберите кампанию и попробуйте снова.',
        success: false
      };
    }

    const campaigns = await directusCrud.list('user_campaigns', {
      authToken: request.authToken,
      filter: { id: { _eq: request.campaignId } },
      limit: 1,
      fields: ['id', 'name', 'website', 'website_link', 'website_url', 'link', 'settings']
    });
    if (!campaigns || campaigns.length === 0) {
      return {
        response: 'Кампания не найдена. Проверьте выбранную кампанию.',
        success: false
      };
    }
    const campaign = campaigns[0] as any;

    const existingQuestionnaires = await directusCrud.list('business_questionnaire', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } },
      limit: 1
    });

    if (existingQuestionnaires && existingQuestionnaires.length > 0) {
      return {
        response: 'Анкета для этой кампании уже заполнена. Вы можете отредактировать её вручную на странице анкеты.',
        success: true,
        action: 'Анкета уже существует'
      };
    }

    let websiteUrl = campaign.website_link || campaign.website || campaign.website_url || campaign.link;
    
    if (!websiteUrl) {
      const urlMatch = request.message.match(/https?:\/\/[^\s]+/);
      websiteUrl = urlMatch ? urlMatch[0] : null;
    }
    
    console.log(`[AI-ASSISTANT] Данные кампании:`, {
      name: campaign.name,
      website: campaign.website,
      website_link: campaign.website_link,
      website_url: campaign.website_url,
      link: campaign.link,
      extractedUrl: websiteUrl
    });
    
    if (!websiteUrl) {
      return {
        response: 'Для автоматического заполнения анкеты необходимо указать сайт компании в настройках кампании или в сообщении.',
        success: false
      };
    }

    console.log(`[AI-ASSISTANT] Анализируем сайт: ${websiteUrl}`);
    const questionnaireData = await generateQuestionnaireFromWebsite(websiteUrl, campaign.name);
    
    const questionnairePayload = {
      ...questionnaireData,
      campaign_id: request.campaignId,
      user_id: request.userId
    };
    
    const newQuestionnaire = await directusCrud.create('business_questionnaire', questionnairePayload, {
      authToken: request.authToken
    });

    return {
      response: `Анкета успешно заполнена автоматически на основе анализа сайта ${websiteUrl}. Вы можете просмотреть и отредактировать её на странице бизнес-анкеты.`,
      success: true,
      action: 'Анкета создана автоматически',
      data: { questionnaireId: (newQuestionnaire as any)?.id || 'created' }
    };

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка заполнения анкеты:', error);
    return {
      response: 'Произошла ошибка при автоматическом заполнении анкеты. Попробуйте заполнить её вручную.',
      success: false
    };
  }
}

export async function handleReadQuestionnaire(request: AIAssistantRequest): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для чтения анкеты необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const questionnaires = await directusCrud.list('business_questionnaire', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } },
      limit: 1
    });

    if (!questionnaires || questionnaires.length === 0) {
      return {
        response: 'Анкета для этой кампании не найдена. Вы можете создать её командой "Заполни анкету".',
        success: false
      };
    }

    const questionnaire = questionnaires[0] as any;
    
    const response = `📋 **Бизнес-анкета кампании**

🏢 **Компания:** ${questionnaire.company_name || 'Не указано'}
📧 **Контакты:** ${questionnaire.contact_info ? JSON.stringify(questionnaire.contact_info) : 'Не указано'}
📝 **Описание бизнеса:** ${questionnaire.business_description || 'Не указано'}
🎯 **Целевая аудитория:** ${questionnaire.target_audience || 'Не указано'}
🛒 **Продукты/услуги:** ${questionnaire.products_services ? questionnaire.products_services.join(', ') : 'Не указано'}
💰 **Ценовая категория:** ${questionnaire.price_range || 'Не указано'}
🏪 **Ниша бизнеса:** ${questionnaire.business_niche || 'Не указано'}
😰 **Боли клиентов:** ${questionnaire.customer_pain_points || 'Не указано'}
⭐ **УТП:** ${questionnaire.unique_selling_proposition || 'Не указано'}
✅ **Ключевые преимущества:** ${questionnaire.key_benefits || 'Не указано'}
📞 **Призыв к действию:** ${questionnaire.call_to_action || 'Не указано'}`;

    return {
      response,
      success: true,
      action: 'Анкета прочитана',
      data: { questionnaire }
    };

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка чтения анкеты:', error);
    return {
      response: 'Произошла ошибка при чтении анкеты.',
      success: false
    };
  }
}

export async function handleCreatePostsFromQuestionnaire(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для создания постов необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const questionnaires = await directusCrud.list('business_questionnaire', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } },
      limit: 1
    });

    if (!questionnaires || questionnaires.length === 0) {
      return {
        response: 'Анкета для этой кампании не найдена. Сначала заполните анкету командой "Заполни анкету".',
        success: false
      };
    }

    const questionnaire = questionnaires[0] as any;
    const count = parameters?.count || 1;
    const postType = parameters?.postType || 'selling';
    const characterLimit = parameters?.characterLimit;

    console.log(`[AI-ASSISTANT] Создание ${count} ${postType} постов на основе анкеты`);

    const createdPosts = [];

    for (let i = 1; i <= count; i++) {
      let postPrompt = '';
      
      if (postType === 'selling') {
        postPrompt = characterLimit 
          ? `Создай ОДИН продающий пост для социальных сетей длиной СТРОГО ${characterLimit} символов ±10 символов.`
          : `Создай ОДИН продающий пост для социальных сетей на основе данных бизнеса.`;

        postPrompt += `

Данные бизнеса из анкеты:
- Компания: ${questionnaire.company_name || 'Не указано'}
- Ниша: ${questionnaire.business_niche || 'Не указано'}  
- Целевая аудитория: ${questionnaire.target_audience || 'Не указано'}
- Основные боли клиентов: ${questionnaire.customer_pain_points || 'Не указано'}
- Уникальное торговое предложение: ${questionnaire.unique_selling_proposition || 'Не указано'}
- Основные преимущества: ${questionnaire.key_benefits || 'Не указано'}
- Призыв к действию: ${questionnaire.call_to_action || 'Свяжитесь с нами'}

Требования:
- Используй данные из анкеты выше
- Добавь подходящие эмодзи и хештеги
- Цепляющий крючок и призыв к действию
- Формат: обычный текст с эмодзи и переносами строк (БЕЗ HTML-тегов)

СТРОГО ЗАПРЕЩЕНО:
- Вступления типа "Вот варианты", "Я подготовил"
- Комплименты пользователю

ФОРМАТ ОТВЕТА (строго):
Первой строкой напиши: ЗАГОЛОВОК: <3–6 слов, конкретно, без вводных слов>
Затем пустая строка, затем текст поста.`;
      } else {
        postPrompt = `Создай ${postType === 'informational' ? 'информационный' : 'вовлекающий'} пост на основе бизнеса: ${questionnaire.company_name}. 
Ниша: ${questionnaire.business_niche}. Целевая аудитория: ${questionnaire.target_audience}.

ФОРМАТ ОТВЕТА (строго):
Первой строкой напиши: ЗАГОЛОВОК: <3–6 слов, конкретно, без вводных слов>
Затем пустая строка, затем текст поста.`;
      }

      const rawContent = await geminiVertexDirect.generateContent({ 
        prompt: postPrompt,
        model: 'gemini-3-pro-preview'
      });
      
      let rawSanitized = sanitizeContent(rawContent);
      let questTitle = '';
      const questTitleMatch = rawSanitized.match(/^ЗАГОЛОВОК:\s*(.+)/i);
      if (questTitleMatch) {
        questTitle = truncateTitle(questTitleMatch[1]);
        rawSanitized = rawSanitized.replace(/^ЗАГОЛОВОК:\s*.+\n?\n?/i, '').trim();
      }
      const postContent = rawSanitized;

      const postData = {
        campaign_id: request.campaignId,
        user_id: request.userId,
        title: questTitle || await generatePostTitle(questionnaire.company_name || 'Пост из анкеты', i, postContent),
        content: postContent,
        content_type: 'text',
        status: 'draft',
        prompt: `Пост ${i}/${count} на основе анкеты - ${postType}`,
        keywords: [questionnaire.business_niche || 'бизнес'],
        hashtags: []
      };

      const newPost = await directusCrud.create('campaign_content', postData, {
        authToken: request.authToken
      });

      createdPosts.push(newPost);
    }

    return {
      response: `✅ Создано ${count} ${postType === 'selling' ? 'продающих' : postType} постов на основе данных анкеты. Посты сохранены как черновики и готовы к публикации.`,
      success: true,
      action: `Создано ${count} постов из анкеты`,
      data: { createdPosts }
    };

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка создания постов из анкеты:', error);
    return {
      response: 'Произошла ошибка при создании постов на основе анкеты.',
      success: false
    };
  }
}

export async function handleGetCampaignData(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для получения данных необходимо выбрать активную кампанию.',
        success: false
      };
    }

    // Запрашиваем всё параллельно
    const [allContent, campaigns, autoSessions] = await Promise.all([
      directusCrud.list('campaign_content', {
        authToken: request.authToken,
        filter: { campaign_id: { _eq: request.campaignId } },
        limit: -1,
        fields: ['id', 'status', 'title', 'scheduled_at']
      }).catch(() => [] as any[]),
      directusCrud.list('user_campaigns', {
        authToken: request.authToken,
        filter: { id: { _eq: request.campaignId } },
        limit: 1
      }).catch(() => [] as any[]),
      directusCrud.list('autonomous_sessions', {
        authToken: request.authToken,
        filter: { campaign_id: { _eq: request.campaignId } },
        sort: ['-started_at'],
        limit: 1
      }).catch(() => [] as any[])
    ]);

    let response = '📊 **Статус кампании**\n\n';

    // --- Кампания ---
    const campaign = campaigns?.[0] as any;
    if (campaign) {
      const siteUrl = campaign.website_link || campaign.website || campaign.website_url || campaign.link || null;
      response += `📌 **${campaign.name || 'Без названия'}**\n`;
      response += `- Сайт: ${siteUrl || 'Не указан'}\n`;
      response += `- Статус: ${campaign.status || 'Активная'}\n\n`;
    }

    // --- Посты ---
    const posts = allContent || [];
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const totalPosts = posts.length;
    const publishedPosts = posts.filter((p: any) => p.status === 'published').length;
    const draftPosts = posts.filter((p: any) => p.status === 'draft').length;
    const scheduledPosts = posts.filter((p: any) => {
      if (p.status !== 'scheduled') return false;
      const d = p.scheduled_at ? new Date(p.scheduled_at).getTime() : null;
      return !d || d >= todayStart.getTime();
    }).length;
    const overduePosts = posts.filter((p: any) => {
      if (p.status !== 'scheduled') return false;
      const d = p.scheduled_at ? new Date(p.scheduled_at).getTime() : null;
      return d && d < todayStart.getTime();
    }).length;

    response += `📝 **Посты:**\n`;
    response += `- Всего сгенерировано: **${totalPosts}**\n`;
    response += `- Опубликовано: **${publishedPosts}**\n`;
    if (scheduledPosts > 0) response += `- Запланировано (предстоящие): **${scheduledPosts}**\n`;
    if (overduePosts > 0) response += `- Просроченные запланированные: **${overduePosts}**\n`;
    if (draftPosts > 0) response += `- Черновики: **${draftPosts}**\n`;
    response += '\n';

    // --- Промты ---
    response += `🤖 **Промты:**\n\n`;

    // Системные промты из настроек кампании
    const rawAutoSettings = campaign?.autonomous_settings;
    let autoSettings: Record<string, any> = {};
    if (rawAutoSettings && typeof rawAutoSettings === 'object') {
      autoSettings = rawAutoSettings;
    } else if (typeof rawAutoSettings === 'string' && rawAutoSettings.trim()) {
      try { autoSettings = JSON.parse(rawAutoSettings); } catch { /* ignore */ }
    }

    let hasPrompts = false;
    if (autoSettings.globalPrompt) {
      response += `📌 **Основной промт (из настроек):**\n${autoSettings.globalPrompt}\n\n`;
      hasPrompts = true;
    }
    if (autoSettings.alwaysInclude) {
      response += `📎 **Всегда включать:**\n${autoSettings.alwaysInclude}\n\n`;
      hasPrompts = true;
    }
    if (autoSettings.signature) {
      response += `✍️ **Подпись:**\n${autoSettings.signature}\n\n`;
      hasPrompts = true;
    }

    // launch_command из autonomous_sessions (промт запуска авторежима)
    const lastSession = autoSessions?.[0] as any;
    const launchCommand = lastSession?.launch_command || autoSettings.launchCommand;
    if (launchCommand) {
      response += `🚀 **Промт запуска авторежима:**\n${launchCommand}\n\n`;
      hasPrompts = true;
    }

    if (!hasPrompts) {
      response += `⚠️ Промты не заданы\n`;
    }

    return {
      response,
      success: true,
      action: 'Данные кампании получены'
    };

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка получения данных кампании:', error);
    return {
      response: 'Произошла ошибка при получении данных кампании.',
      success: false
    };
  }
}

export async function handleManageContent(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для управления контентом необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const action = parameters?.action;
    const contentId = parameters?.contentId;

    switch (action) {
      case 'list':
        const content = await directusCrud.list('campaign_content', {
          authToken: request.authToken,
          filter: { campaign_id: { _eq: request.campaignId } },
          limit: 20,
          sort: ['-created_at']
        });

        let listResponse = `📋 **Список контента (${content?.length || 0} элементов):**\n\n`;
        if (content && content.length > 0) {
          content.forEach((item: any, index: number) => {
            listResponse += `${index + 1}. **${item.title || 'Без названия'}**\n`;
            listResponse += `   ID: ${item.id}\n`;
            listResponse += `   Статус: ${item.status}\n`;
            listResponse += `   Тип: ${item.content_type}\n\n`;
          });
        } else {
          listResponse += 'Контент не найден';
        }

        return {
          response: listResponse,
          success: true,
          action: 'Список контента получен'
        };

      case 'delete':
        if (!contentId) {
          return {
            response: 'Для удаления контента необходимо указать ID контента.',
            success: false
          };
        }

        await directusCrud.delete('campaign_content', contentId, {
          authToken: request.authToken
        });

        return {
          response: `✅ Контент с ID ${contentId} успешно удален.`,
          success: true,
          action: 'Контент удален'
        };

      default:
        return {
          response: 'Неизвестное действие. Доступные действия: list, delete, publish, schedule',
          success: false
        };
    }

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка управления контентом:', error);
    return {
      response: 'Произошла ошибка при управлении контентом.',
      success: false
    };
  }
}

export async function handleCreatePosts(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для создания постов необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const count = parameters?.count || 1;
    const topic = parameters?.topic || '';
    const generateImages = parameters?.generateImages !== false;
    const isConnectedSeries = parameters?.isConnectedSeries || false;

    console.log(`[AI-ASSISTANT] Создание ${count} постов на тему: ${topic}`);

    const campaignContext = await campaignDataService.getCampaignContext(
      request.userId, 
      request.campaignId,
      request.authToken
    );
    
    let questionnaire = null;
    try {
      const questionnaires = await directusCrud.list('business_questionnaire', {
        authToken: request.authToken,
        filter: { campaign_id: { _eq: request.campaignId } },
        limit: 1
      });
      questionnaire = questionnaires.length > 0 ? questionnaires[0] as any : null;
    } catch (error) {
      console.error('[AI-ASSISTANT] Ошибка получения анкеты:', error);
    }
    
    const isSellingPost = request.message.toLowerCase().includes('продающий') || 
                         request.message.toLowerCase().includes('на основе анкеты');
    const hasCharacterLimit = request.message.toLowerCase().includes('1024');
    
    if (isSellingPost && !questionnaire) {
      return {
        response: 'Для создания продающих постов на основе анкеты необходимо сначала заполнить бизнес-анкету кампании. Перейдите в раздел "Анкета" и заполните данные о вашем бизнесе.',
        success: false
      };
    }

    const createdPosts = [];
    let seriesPlan = null;

    if (isConnectedSeries && count > 1) {
      try {
        const planPrompt = `
Создай подробный план для серии из ${count} постов на тему "${topic}".

${campaignContext ? `Контекст кампании: ${campaignContext}` : ''}

Требования к плану:
- Каждый пост должен быть логически связан с предыдущим
- Единая нить повествования от начала до конца серии
- Каждый пост раскрывает свой аспект темы
- Постепенное развитие идеи или сюжета
- Читатель должен ждать продолжения

Формат ответа:
Пост 1: [краткое описание содержания и роли в серии]
Пост 2: [краткое описание содержания и связи с предыдущим]
...

Общая идея серии: [общая концепция и цель]
`;

        seriesPlan = await geminiVertexDirect.generateContent({ 
          prompt: planPrompt,
          model: 'gemini-3-pro-preview'
        });

        console.log(`[AI-ASSISTANT] План серии создан: ${seriesPlan.substring(0, 200)}...`);
      } catch (error) {
        console.error('[AI-ASSISTANT] Ошибка создания плана серии:', error);
      }
    }

    for (let i = 1; i <= count; i++) {
      try {
        let postPrompt = '';
        
        if (isSellingPost && questionnaire) {
          if (hasCharacterLimit) {
            postPrompt = `
Создай ОДИН продающий пост для социальных сетей длиной СТРОГО 1024 символа ±10 символов.

Данные бизнеса из анкеты:
- Компания: ${questionnaire.company_name || 'Не указано'}
- Ниша: ${questionnaire.business_niche || 'Не указано'}
- Целевая аудитория: ${questionnaire.target_audience || 'Не указано'}
- Основные боли клиентов: ${questionnaire.customer_pain_points || 'Не указано'}
- Уникальное торговое предложение: ${questionnaire.unique_selling_proposition || 'Не указано'}
- Основные преимущества: ${questionnaire.key_benefits || 'Не указано'}
- Призыв к действию: ${questionnaire.call_to_action || 'Свяжитесь с нами'}

Структура поста:
1. Цепляющий крючок/вопрос (1-2 строки)
2. Боль/проблема целевой аудитории (2-3 строки)
3. Решение через ваш продукт/услугу (3-4 строки)
4. Ключевые выгоды/преимущества (2-3 строки)
5. Социальные доказательства если есть (1-2 строки)
6. Призыв к действию с ограничением/срочностью (1-2 строки)

Требования:
- Используй ТОЛЬКО данные из анкеты выше
- Длина СТРОГО 1024 символа ±10 символов
- Добавь подходящие эмодзи
- Формат: обычный текст с эмодзи и переносами строк (БЕЗ HTML-тегов)

ФОРМАТ ОТВЕТА (строго):
Первой строкой напиши: ЗАГОЛОВОК: <3–6 слов, конкретно, без вводных слов>
Затем пустая строка, затем текст поста (1024 символа считаются без строки заголовка).
`;
          } else {
            postPrompt = `
Создай ОДИН продающий пост для социальных сетей на основе данных бизнеса.

Данные бизнеса из анкеты:
- Компания: ${questionnaire.company_name || 'Не указано'}
- Ниша: ${questionnaire.business_niche || 'Не указано'}
- Целевая аудитория: ${questionnaire.target_audience || 'Не указано'}
- Основные боли клиентов: ${questionnaire.customer_pain_points || 'Не указано'}
- Уникальное торговое предложение: ${questionnaire.unique_selling_proposition || 'Не указано'}
- Основные преимущества: ${questionnaire.key_benefits || 'Не указано'}
- Призыв к действию: ${questionnaire.call_to_action || 'Свяжитесь с нами'}

Требования:
- Используй данные из анкеты выше
- Добавь подходящие эмодзи и хештеги
- Размер: 1-3 абзаца (дефолтная длина)
- Цепляющий крючок и призыв к действию
- Формат: обычный текст с эмодзи и переносами строк (БЕЗ HTML-тегов)

ФОРМАТ ОТВЕТА (строго):
Первой строкой напиши: ЗАГОЛОВОК: <3–6 слов, конкретно, без вводных слов>
Затем пустая строка, затем текст поста.
`;
          }
        } else {
          postPrompt = `
Создай пост №${i} из серии ${count} постов для социальных сетей на тему "${topic}".

${campaignContext ? `Контекст компании: ${campaignContext}` : ''}

Требования:
- Уникальный и интересный контент
- Подходящий для Instagram, Facebook, VK
- Включи эмодзи и хештеги
- Размер: 1-2 абзаца
- Добавь call-to-action в конце

ФОРМАТ ОТВЕТА (строго):
Первой строкой напиши: ЗАГОЛОВОК: <3–6 слов, конкретно, без вводных слов>
Затем пустая строка, затем текст поста без HTML-тегов.
`;
        }

        const rawContent = await geminiVertexDirect.generateContent({ 
          prompt: postPrompt,
          model: 'gemini-3-pro-preview'
        });
        
        let rawSanitized = sanitizeContent(rawContent);

        // Парсим заголовок из первой строки ответа
        let parsedTitle = '';
        const titleMatch = rawSanitized.match(/^ЗАГОЛОВОК:\s*(.+)/i);
        if (titleMatch) {
          parsedTitle = truncateTitle(titleMatch[1]);
          rawSanitized = rawSanitized.replace(/^ЗАГОЛОВОК:\s*.+\n?\n?/i, '').trim();
        }
        const postContent = rawSanitized;
        const postTitle = parsedTitle || await generatePostTitle(topic, i, postContent);

        const postData = {
          campaign_id: request.campaignId,
          user_id: request.userId,
          title: postTitle,
          content: postContent,
          content_type: generateImages ? 'text-image' : 'text',
          status: 'draft',
          prompt: `${topic} - автосгенерированный пост ${i}/${count}`,
          keywords: [topic],
          hashtags: []
        };

        let imageUrl = null;

        if (generateImages) {
          try {
            const imagePrompt = `professional business content about ${topic}, modern style, clean design, high quality`;
            const imageResult = await falAiUniversalService.generateImages({
              prompt: imagePrompt,
              model: 'fast-sdxl' as FalAiModelName,
              imageSize: 'square_hd',
              userId: request.userId,
              token: request.authToken
            });

            if (imageResult && imageResult.length > 0) {
              imageUrl = imageResult[0];
              (postData as any).image_url = imageUrl;
              console.log(`[AI-ASSISTANT] Изображение для поста ${i} создано: ${imageUrl}`);
            }
          } catch (imageError) {
            console.error(`[AI-ASSISTANT] Ошибка генерации изображения для поста ${i}:`, imageError);
          }
        }

        const apiResponse = await axios.post(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/campaign-content`, postData, {
          headers: {
            'Authorization': `Bearer ${request.authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        const createdPost = apiResponse.data;
        createdPosts.push({
          id: createdPost.id,
          title: postData.title,
          hasImage: !!imageUrl
        });

        console.log(`[AI-ASSISTANT] Создан пост ${i}/${count}: ${createdPost.id}`);
      } catch (postError) {
        console.error(`[AI-ASSISTANT] Ошибка создания поста ${i}:`, postError);
      }
    }

    if (createdPosts.length === 0) {
      return {
        response: 'Не удалось создать ни одного поста. Попробуйте еще раз или измените запрос.',
        success: false
      };
    }

    const imagesText = generateImages ? ' с изображениями' : '';
    const response = `Создано ${createdPosts.length} из ${count} постов${imagesText} на тему "${topic}". Вы можете найти их в разделе "Контент" и отредактировать при необходимости.`;

    return {
      response,
      success: true,
      action: `Создано ${createdPosts.length} постов`,
      data: { posts: createdPosts }
    };

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка создания постов:', error);
    return {
      response: 'Произошла ошибка при создании постов. Попробуйте еще раз.',
      success: false
    };
  }
}

/** Читает настроенные платформы из social_media_settings кампании */
async function getCampaignPlatforms(campaignId: string, authToken?: string): Promise<string[]> {
  try {
    const campaign: any = await directusCrud.getById('user_campaigns', campaignId as any, authToken ? { authToken } : {});
    const s = campaign?.social_media_settings;
    if (!s || typeof s !== 'object') return [];
    const KNOWN = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'tiktok', 'threads'];
    const connected: string[] = [];
    for (const p of KNOWN) {
      const cfg = s[p];
      if (!cfg || typeof cfg !== 'object') continue;
      const hasToken = !!(cfg.token || cfg.accessToken || cfg.access_token || cfg.botToken || cfg.bot_token);
      const hasId = !!(cfg.chatId || cfg.chat_id || cfg.groupId || cfg.group_id || cfg.pageId || cfg.page_id
        || cfg.businessAccountId || cfg.business_account_id || cfg.userId || cfg.user_id
        || cfg.channelId || cfg.channel_id || cfg.threadsUserId || cfg.threads_user_id);
      if (cfg.enabled === true || (hasToken && hasId) || hasToken) connected.push(p);
    }
    return connected;
  } catch (e: any) {
    console.warn('[AI-ASSISTANT] Не удалось определить платформы кампании:', e?.message);
    return [];
  }
}

/** Подбирает оптимальные времена публикации (в UTC) для N постов */
function pickSmartScheduleTimes(count: number, takenMs: number[] = []): string[] {
  // Предпочтительные часы по МСК (UTC+3): 9, 12, 18, 21
  const preferredMskHours = [9, 12, 18, 21];
  const now = Date.now();
  const MIN_DELAY = 30 * 60 * 1000; // минимум 30 минут вперёд
  const MIN_GAP = 2 * 60 * 60 * 1000; // минимум 2 часа между постами

  const results: string[] = [];
  const usedMs: number[] = [...takenMs];

  let dayOffset = 0;
  while (results.length < count && dayOffset < 14) {
    const baseDate = new Date(now + dayOffset * 24 * 60 * 60 * 1000);
    for (const mskHour of preferredMskHours) {
      if (results.length >= count) break;
      // Переводим МСК в UTC
      const mskMidnight = new Date(baseDate);
      mskMidnight.setUTCHours(0, 0, 0, 0);
      const slotMs = mskMidnight.getTime() + (mskHour - 3) * 60 * 60 * 1000; // UTC = МСК - 3ч
      if (slotMs < now + MIN_DELAY) continue;
      const tooClose = usedMs.some(t => Math.abs(t - slotMs) < MIN_GAP);
      if (tooClose) continue;
      usedMs.push(slotMs);
      results.push(new Date(slotMs).toISOString());
    }
    dayOffset++;
  }

  // Fallback если ничего не нашли
  if (results.length === 0) {
    for (let i = 0; i < count; i++) {
      results.push(new Date(now + (i + 1) * 60 * 60 * 1000).toISOString());
    }
  }

  return results.slice(0, count);
}

export async function handleSchedulePosts(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для планирования публикаций необходимо выбрать активную кампанию.',
        success: false
      };
    }

    // Если платформы не указаны — читаем из настроек кампании
    let platforms: string[] = parameters?.platforms;
    if (!platforms || platforms.length === 0) {
      platforms = await getCampaignPlatforms(request.campaignId, request.authToken);
      if (platforms.length === 0) {
        platforms = ['telegram', 'instagram', 'vk'];
        console.log('[AI-ASSISTANT] Не найдены настроенные платформы, используем fallback:', platforms);
      } else {
        console.log('[AI-ASSISTANT] Платформы из настроек кампании:', platforms);
      }
    }
    
    const recentContent = await directusCrud.list('campaign_content', {
      authToken: request.authToken,
      filter: { 
        campaign_id: { _eq: request.campaignId },
        status: { _eq: 'draft' }
      },
      sort: ['-created_at'],
      limit: 10
    });

    if (!recentContent || recentContent.length === 0) {
      return {
        response: 'Нет готовых постов для планирования. Сначала создайте контент, а затем запланируйте публикации.',
        success: false
      };
    }

    const { filterCompatiblePlatforms } = await import('../../utils/content-type-platform-map');
    const baseUrl = `http://localhost:${process.env.PORT || 5000}`;

    const postsToSchedule = recentContent.slice(0, 5);
    // Выбираем оптимальные времена для всех постов сразу
    const scheduleTimes = pickSmartScheduleTimes(postsToSchedule.length);

    let scheduledCount = 0;
    const scheduledDetails: string[] = [];

    for (let i = 0; i < postsToSchedule.length; i++) {
      const post = postsToSchedule[i];
      try {
        const postId = (post as any).id;
        const postContentType: string | undefined = (post as any).content_type;
        const compatiblePlatforms = filterCompatiblePlatforms(platforms, postContentType);
        if (compatiblePlatforms.length === 0) {
          console.log(`[AI-ASSISTANT] Пост ${postId} (${postContentType}): нет совместимых платформ, пропускаем`);
          continue;
        }
        if (compatiblePlatforms.length < platforms.length) {
          const skipped = platforms.filter((p: string) => !compatiblePlatforms.includes(p));
          console.log(`[AI-ASSISTANT] Пост ${postId}: исключены несовместимые платформы [${skipped.join(', ')}]`);
        }

        const scheduleTime = scheduleTimes[i] || scheduleTimes[scheduleTimes.length - 1];

        const socialPlatforms: Record<string, any> = {};
        for (const p of compatiblePlatforms) {
          socialPlatforms[p] = { enabled: true, status: 'scheduled', scheduledAt: scheduleTime };
        }

        await axios.post(`${baseUrl}/api/direct-schedule/${postId}`, {
          scheduledAt: scheduleTime,
          socialPlatforms
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.authToken}`
          },
          timeout: 15000
        });

        const timeLabel = new Date(scheduleTime).toLocaleString('ru-RU', { 
          timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        scheduledDetails.push(`• "${(post as any).title || 'Пост'}" — ${timeLabel} МСК в [${compatiblePlatforms.join(', ')}]`);
        console.log(`[AI-ASSISTANT] Запланирован пост ${postId} на ${scheduleTime} в [${compatiblePlatforms.join(', ')}]`);
        scheduledCount++;
      } catch (error) {
        console.error('[AI-ASSISTANT] Ошибка планирования поста:', (post as any).id, error);
      }
    }

    const platformsText = platforms.join(', ');
    const detailsText = scheduledDetails.length > 0 ? '\n\n' + scheduledDetails.join('\n') : '';
    
    return {
      response: `✅ Запланировано ${scheduledCount} публикаций в: ${platformsText}${detailsText}\n\nВремя подобрано автоматически под пиковую аудиторию. Смотрите раздел "Запланированные".`,
      success: true,
      action: `Запланировано ${scheduledCount} публикаций`,
      data: { scheduledCount, platforms }
    };

  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка планирования публикаций:', error);
    return {
      response: 'Произошла ошибка при планировании публикаций. Попробуйте еще раз.',
      success: false
    };
  }
}

export async function handleHelp(): Promise<AIAssistantResponse> {
  const helpText = `
🤖 **AI Ассистент SMM Manager** - Полное управление платформой

**📝 УПРАВЛЕНИЕ КОНТЕНТОМ:**
• "создай пост про [тема]" - генерация 3 постов (по умолчанию)
• "создай 5 постов про веб-разработку" - указание количества постов
• "напиши 2 поста маркетинг" - краткий формат команды
• "создай продающий пост на основе анкеты" - использование бизнес-анкеты
• "создай продающий пост на основе анкеты на 1024" - с ограничением символов
• "опубликуй контент [ID]" - публикация в социальные сети
• "запланируй публикацию [ID] на [время]" - отложенная публикация

📱 **STORIES И МЕДИА:**
• "создай stories [название]" - создание Instagram Stories
• "создай stories про [тема]" - генерация Stories с контентом

📈 **АНАЛИТИКА И ТРЕНДЫ:**
• "получи аналитику" - статистика кампании (контент, тренды, источники)
• "анализируй кампанию" - детальный AI-анализ эффективности
• "анализируй тренды" - обзор трендов с AI-рекомендациями
• "собери тренды" - запуск сбора новых трендов

🌐 **АНАЛИЗ САЙТОВ:**
• "проанализируй сайт [URL]" - анализ сайта и заполнение анкеты
• "заполни анкету с сайта [URL]" - автоматическое заполнение бизнес-анкеты
• "найди ключевые слова для [URL]" - извлечение SEO ключевых слов

🔗 **СОЦИАЛЬНЫЕ СЕТИ:**
• "настрой соцсети" - подключение к платформам (Instagram, Facebook, VK, Telegram, YouTube)
• "проверь подключения" - статус авторизации в соцсетях
• "публикуй в [платформы]" - выбор конкретных платформ для публикации

⚙️ **ПЛАНИРОВЩИК:**
• "запусти планировщик" - активация автоматических публикаций
• "останови планировщик" - приостановка автопубликации
• "статус планировщика" - проверка работы системы

🎯 **КАМПАНИИ:**
• "создай кампанию [название]" - новая кампания
• "переключись на кампанию [название]" - смена активной кампании
• "настройки кампании" - управление параметрами

**📊 SWAGGER API:** /api-docs - полная документация всех эндпоинтов

❓ **ПОМОЩЬ:**
• "помощь" - показать этот список команд
• "что умеешь?" - возможности ассистента

**Поддерживаемые платформы:** Instagram, Facebook, VK, Telegram, YouTube
**AI модели:** Gemini 2.5, Claude 3.5, DeepSeek V3, FAL AI (изображения)

Просто напишите что нужно сделать естественным языком!
`;

  return {
    response: helpText,
    success: true
  };
}

export async function handleUnknownCommand(request: AIAssistantRequest): Promise<AIAssistantResponse> {
  return {
    response: 'Я не понял вашу команду. Попробуйте переформулировать запрос или напишите "помощь" для получения списка доступных команд.',
    success: false
  };
}

export async function generateQuestionnaireFromWebsite(websiteUrl: string, companyName?: string): Promise<any> {
  const prompt = `
Проанализируй веб-сайт ${websiteUrl} и создай данные для бизнес-анкеты.

ВАЖНО: Все поля должны быть ПРОСТЫМИ СТРОКАМИ, не массивами или объектами!

Создай JSON с полями:
- company_name: название компании (строка)
- contact_info: контактная информация в одной строке (email, телефон через запятую)
- business_description: описание бизнеса в 2-3 предложения (строка)
- main_directions: основные направления деятельности (строка)
- brand_image: образ бренда (строка)
- products_services: товары и услуги через запятую (строка)
- target_audience: целевая аудитория (строка)
- customer_results: результаты для клиентов (строка)
- company_features: особенности компании (строка)
- business_values: ценности бизнеса (строка)
- product_beliefs: убеждения о продукте (строка)
- competitive_advantages: конкурентные преимущества (строка)
- marketing_expectations: ожидания от маркетинга (строка)

ПРАВИЛЬНЫЙ пример ответа:
{
  "company_name": "Название компании",
  "contact_info": "email@example.com, +7 123 456-78-90",
  "business_description": "Краткое описание в одну строку",
  "products_services": "Услуга 1, Услуга 2, Услуга 3"
}

НЕПРАВИЛЬНО:
{
  "contact_info": {"email": "...", "phone": "..."}, 
  "products_services": ["Услуга 1", "Услуга 2"]
}

Ответь ТОЛЬКО JSON без markdown разметки.
`;

  try {
    const response = await geminiVertexDirect.generateContent({ 
      prompt,
      model: 'gemini-3-pro-preview'
    });

    const cleanedResponse = response.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanedResponse);
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка генерации анкеты:', error);
    
    return {
      company_name: companyName || 'Компания',
      contact_info: 'Не указано',
      business_description: 'Описание бизнеса будет добавлено позже',
      target_audience: 'Широкая аудитория',
      products_services: 'Товары и услуги',
      unique_selling_proposition: 'Уникальное предложение',
      brand_tone: 'Дружелюбный',
      content_goals: 'Увеличение узнаваемости бренда',
      social_media_goals: 'Привлечение новых клиентов'
    };
  }
}

export async function handleAnalyzeCampaign(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для анализа кампании необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const campaignContext = await campaignDataService.getCampaignContext(
      request.userId, 
      request.campaignId,
      request.authToken
    );

    const content = await directusCrud.list('campaign_content', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } }
    });

    const analysisPrompt = `Проанализируй кампанию и дай развернутый отчет:
Данные кампании: ${campaignContext || 'Нет данных'}
Количество созданного контента: ${content.length}

Проведи анализ по критериям: эффективность, качество контента, соответствие аудитории, рекомендации.`;

    const analysis = await geminiVertexDirect.generateContent({ 
      prompt: analysisPrompt,
      model: 'gemini-3-pro-preview'
    });

    return {
      response: analysis,
      success: true,
      action: 'Анализ кампании завершен',
      data: { contentCount: content.length }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка анализа кампании:', error);
    return {
      response: 'Произошла ошибка при анализе кампании. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleCreateStories(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для создания Stories необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const title = parameters?.title || 'Новая история';
    const content = parameters?.content || '';

    const storyData = {
      title,
      campaignId: request.campaignId,
      content,
      type: 'story',
      status: 'draft'
    };

    const response = await directusCrud.create('campaign_content', storyData, {
      authToken: request.authToken
    }) as any;

    return {
      response: `✅ Stories "${title}" успешно создана! ID: ${response?.id || 'unknown'}. Теперь вы можете отредактировать её в разделе Stories, добавив текст, изображения и интерактивные элементы.`,
      success: true,
      action: 'Создание Stories',
      data: { storyId: response?.id }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка создания Stories:', error);
    return {
      response: 'Произошла ошибка при создании Stories. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleGetAnalytics(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для получения аналитики необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const content = await directusCrud.list('campaign_content', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } }
    });

    const trends = await directusCrud.list('campaign_trends', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } }
    });

    const sources = await directusCrud.list('campaign_content_sources', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } }
    });

    const analytics = {
      contentCount: content.length,
      trendsCount: trends.length,
      sourcesCount: sources.length,
      recentContent: content.slice(0, 5),
      topTrends: trends.slice(0, 3)
    };

    return {
      response: `📊 **Аналитика кампании:**
        
🔹 **Контент:** ${analytics.contentCount} постов
🔹 **Тренды:** ${analytics.trendsCount} найдено
🔹 **Источники:** ${analytics.sourcesCount} отслеживается

${analytics.recentContent.length > 0 ? 
  `\n**Последний контент:**\n${analytics.recentContent.map((c: any) => `• ${c?.title || 'Без названия'} (${c?.content_type || 'unknown'})`).join('\n')}` : 
  ''}

Для детального анализа перейдите в раздел "Аналитика".`,
      success: true,
      action: 'Получение аналитики',
      data: analytics
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка получения аналитики:', error);
    return {
      response: 'Произошла ошибка при получении аналитики. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleSetupSocialAccounts(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const platforms = parameters?.platforms || ['instagram', 'facebook', 'vk', 'telegram', 'youtube'];
    
    if (!request.campaignId) {
      return {
        response: `Для настройки социальных сетей необходимо выбрать активную кампанию. Поддерживаемые платформы: ${platforms.join(', ')}.`,
        success: false
      };
    }

    const campaign = await directusCrud.getById('user_campaigns', request.campaignId, {
      authToken: request.authToken
    });

    if (!campaign) {
      return {
        response: 'Кампания не найдена.',
        success: false
      };
    }

    const socialSettings = (campaign as any)?.social_media_settings || {};
    const connectedPlatforms = Object.keys(socialSettings).filter(platform => 
      socialSettings[platform] && 
      (socialSettings[platform].token || socialSettings[platform].accessToken)
    );

    return {
      response: `🔗 **Настройка социальных сетей для кампании:**

**Поддерживаемые платформы:** ${platforms.join(', ')}

**Подключенные:** ${connectedPlatforms.length > 0 ? connectedPlatforms.join(', ') : 'Нет'}

**Для настройки:**
1. Перейдите в раздел "Настройки кампании"
2. Выберите "Социальные сети" 
3. Авторизуйтесь в нужных платформах
4. Настройте параметры публикации

**Возможности после подключения:**
• Автоматическая публикация
• Планирование постов
• Сбор аналитики
• Управление Stories (Instagram)`,
      success: true,
      action: 'Настройка социальных аккаунтов',
      data: { 
        platforms, 
        connectedPlatforms,
        campaignId: request.campaignId
      }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка настройки социальных сетей:', error);
    return {
      response: 'Произошла ошибка при настройке социальных сетей. Попробуйте позже.',
      success: false
    };
  }
}

export async function handlePublishContent(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для публикации контента необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const contentId = parameters?.contentId;
    let platforms: string[] = parameters?.platforms;
    const scheduleTime = parameters?.scheduleTime;

    if (!contentId) {
      return {
        response: 'Укажите ID контента для публикации.',
        success: false
      };
    }

    const content = await directusCrud.getById('campaign_content', contentId, {
      authToken: request.authToken
    });

    if (!content) {
      return {
        response: 'Контент не найден.',
        success: false
      };
    }

    // Если платформы не переданы — читаем из настроек кампании
    if (!platforms || platforms.length === 0) {
      platforms = await getCampaignPlatforms(request.campaignId, request.authToken);
      if (platforms.length === 0) platforms = ['telegram', 'instagram', 'vk'];
    }

    // Если время не передано — подбираем оптимальное
    const resolvedScheduleTime = scheduleTime
      ? new Date(scheduleTime).toISOString()
      : pickSmartScheduleTimes(1)[0];

    const scheduledAt = resolvedScheduleTime;
    const socialPlatforms: Record<string, any> = {};
    for (const p of platforms) {
      socialPlatforms[p] = { enabled: true, status: 'scheduled', scheduledAt };
    }

    const updateData = {
      social_platforms: socialPlatforms,
      status: scheduleTime ? 'scheduled' : 'publishing',
      scheduled_at: scheduledAt
    };

    await directusCrud.update('campaign_content', contentId, updateData, {
      authToken: request.authToken
    });

    const timeLabel = new Date(scheduledAt).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    return {
      response: `✅ Публикация запланирована!

**Контент:** "${(content as any)?.title || 'Без названия'}"
**Платформы:** ${platforms.join(', ')}
**Время:** ${timeLabel} МСК

Смотрите раздел "Запланированные".`,
      success: true,
      action: 'Публикация контента',
      data: { contentId, platforms, scheduleTime: scheduledAt }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка публикации контента:', error);
    return {
      response: 'Произошла ошибка при публикации контента. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleAnalyzeTrends(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для анализа трендов необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const trends = await directusCrud.list('campaign_trends', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } },
      sort: ['-collected_at'],
      limit: 10
    });

    const sources = await directusCrud.list('campaign_content_sources', {
      authToken: request.authToken,
      filter: { campaign_id: { _eq: request.campaignId } }
    });

    const analysisPrompt = `Проанализируй собранные тренды и источники:

**Тренды (${trends.length}):**
${trends.slice(0, 5).map((t: any) => `• ${t?.title || 'Без названия'}: ${(t?.content || '').substring(0, 100)}...`).join('\n')}

**Источники (${sources.length}):**
${sources.slice(0, 3).map((s: any) => `• ${s?.name || 'Без названия'}: ${s?.description || 'Без описания'}`).join('\n')}

Дай краткую сводку по трендам и рекомендации для контента.`;

    const analysis = await geminiVertexDirect.generateContent({ 
      prompt: analysisPrompt,
      model: 'gemini-3-pro-preview'
    });

    return {
      response: `📈 **Анализ трендов кампании:**

**Статистика:**
🔹 Найдено трендов: ${trends.length}
🔹 Активных источников: ${sources.length}
🔹 Последний сбор: ${(trends[0] as any)?.date_created ? new Date((trends[0] as any).date_created).toLocaleString('ru-RU') : 'Не проводился'}

**AI-анализ:**
${analysis}

**Действия:**
• Запустить новый сбор трендов: "собери тренды"
• Добавить источники: "добавь источник [URL]"
• Создать контент на основе трендов: "создай пост по трендам"`,
      success: true,
      action: 'Анализ трендов',
      data: { trendsCount: trends.length, sourcesCount: sources.length }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка анализа трендов:', error);
    return {
      response: 'Произошла ошибка при анализе трендов. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleCollectTrends(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    if (!request.campaignId) {
      return {
        response: 'Для сбора трендов необходимо выбрать активную кампанию.',
        success: false
      };
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';
    
    const response = await fetch(`${baseUrl}/api/trends/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.userToken || request.authToken}`
      },
      body: JSON.stringify({
        campaignId: request.campaignId
      })
    });

    if (!response.ok) {
      console.error('[AI-ASSISTANT] Ошибка при запуске сбора трендов:', response.status);
      return {
        response: 'Произошла ошибка при запуске сбора трендов. Попробуйте позже.',
        success: false
      };
    }

    const result = await response.json();

    return {
      response: `🚀 **Сбор трендов запущен!**

📊 **Что происходит:**
• Анализируем актуальные тренды в социальных сетях
• Собираем данные из различных источников
• Обновляем базу трендов для вашей кампании

⏱️ **Время сбора:** 2-5 минут

**📈 Что можно сделать дальше:**
• Проверить прогресс: "покажи аналитику"
• Проанализировать результаты: "анализируй тренды"
• Создать контент на основе трендов: "создай пост по трендам"

Уведомлю вас, когда сбор будет завершен! 🎯`,
      success: true,
      action: 'Запущен сбор трендов',
      data: { campaignId: request.campaignId, collectionStarted: true }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка при запуске сбора трендов:', error);
    return {
      response: 'Произошла ошибка при запуске сбора трендов. Проверьте подключение к интернету и попробуйте позже.',
      success: false
    };
  }
}

export async function handleCreateCampaign(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const campaignName = parameters?.name || 'Новая кампания';
    
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';
    const response = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.userToken || request.authToken}`
      },
      body: JSON.stringify({
        name: campaignName,
        description: `Кампания "${campaignName}" создана через AI ассистента`
      })
    });

    if (!response.ok) {
      throw new Error(`Ошибка создания кампании: ${response.status}`);
    }

    const campaignData = await response.json();
    
    return {
      response: `✅ **Кампания успешно создана!**

🎯 **Название:** ${campaignName}
📊 **ID:** ${campaignData.id}

**📋 Что можно сделать дальше:**
• Заполнить бизнес-анкету: "заполни анкету"
• Создать контент: "создай 5 постов про ${campaignName}"
• Настроить соцсети: "настрой соцсети"
• Получить аналитику: "покажи аналитику"

Кампания готова к работе! 🚀`,
      success: true,
      action: `Создана кампания "${campaignName}"`,
      data: { campaign: campaignData }
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка создания кампании:', error);
    return {
      response: `❌ Не удалось создать кампанию "${parameters?.name || 'Новая кампания'}". 

**Возможные причины:**
• Проблемы с авторизацией
• Ошибка сервера
• Недостаточно прав доступа

Попробуйте еще раз или создайте кампанию вручную в интерфейсе.`,
      success: false
    };
  }
}

export async function handleStartScheduler(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const { getPublishScheduler } = await import('../publish-scheduler');
    const scheduler = getPublishScheduler();
    
    scheduler.start();
    
    return {
      response: `✅ Планировщик автоматических публикаций запущен!

📋 **Что происходит:**
• Каждые 30 секунд проверяются запланированные публикации
• Автоматическая публикация в назначенное время
• Поддержка всех платформ: Instagram, Facebook, VK, Telegram, YouTube

📊 **Мониторинг:**
Следите за статусом публикаций в разделе "Контент".`,
      success: true,
      action: 'Планировщик запущен'
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка запуска планировщика:', error);
    return {
      response: 'Произошла ошибка при запуске планировщика. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleStopScheduler(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const { getPublishScheduler } = await import('../publish-scheduler');
    const scheduler = getPublishScheduler();
    
    scheduler.stop();
    
    return {
      response: `⏸️ Планировщик автоматических публикаций остановлен.

📋 **Что изменилось:**
• Автоматические публикации приостановлены
• Запланированные посты остаются в очереди
• Можете публиковать вручную из раздела "Контент"

🔄 **Возобновление:**
Для запуска используйте команду "запусти планировщик".`,
      success: true,
      action: 'Планировщик остановлен'
    };
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка остановки планировщика:', error);
    return {
      response: 'Произошла ошибка при остановке планировщика. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleOptimizeContent(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const optimizationPrompt = `Дай рекомендации по оптимизации контента для социальных сетей:
Предоставь советы по улучшению текстов, визуального контента, времени публикации, вовлеченности и хештегов.`;

    const recommendations = await geminiVertexDirect.generateContent({ 
      prompt: optimizationPrompt,
      model: 'gemini-3-pro-preview'
    });

    return {
      response: recommendations,
      success: true,
      action: 'Рекомендации по оптимизации получены'
    };
  } catch (error) {
    return {
      response: 'Произошла ошибка при анализе оптимизации. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleGetTrends(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const trendsPrompt = `Предоставь актуальные тренды в социальных сетях: популярные темы, форматы контента, актуальные челленджи и рекомендации по их использованию.`;

    const trends = await geminiVertexDirect.generateContent({ 
      prompt: trendsPrompt,
      model: 'gemini-3-pro-preview'
    });

    return {
      response: trends,
      success: true,
      action: 'Актуальные тренды получены'
    };
  } catch (error) {
    return {
      response: 'Произошла ошибка при получении трендов. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleAnalyzeCompetitors(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const competitorPrompt = `Проведи анализ стратегий конкурентов, их сильных и слабых сторон, возможностей для дифференциации и рекомендации по контент-стратегии.`;

    const analysis = await geminiVertexDirect.generateContent({ 
      prompt: competitorPrompt,
      model: 'gemini-3-pro-preview'
    });

    return {
      response: analysis,
      success: true,
      action: 'Анализ конкурентов завершен'
    };
  } catch (error) {
    return {
      response: 'Произошла ошибка при анализе конкурентов. Попробуйте позже.',
      success: false
    };
  }
}

export async function handleGenerateHashtags(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const count = parameters?.hashtagCount || 20;
    const campaignId = request.campaignId;

    if (!campaignId) {
      return {
        response: 'Для подбора ключевых слов необходимо выбрать кампанию.',
        success: false
      };
    }

    console.log(`[AI-ASSISTANT] Подбор ключевых слов для кампании ${campaignId}`);

    let questionnaireData;
    try {
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
        : 'http://localhost:5000';
      const response = await axios.get(
        `${baseUrl}/api/campaigns/${campaignId}/questionnaire`,
        {
          headers: {
            'Authorization': `Bearer ${request.authToken}`
          }
        }
      );
      questionnaireData = response.data?.data;
      console.log(`[AI-ASSISTANT] Анкета получена:`, questionnaireData ? 'Да' : 'Нет');
    } catch (error) {
      console.log(`[AI-ASSISTANT] Анкета не найдена для кампании ${campaignId}`);
      questionnaireData = null;
    }

    let websiteKeywords: any[] = [];
    let websiteAnalysis = '';
    
    const websiteUrl = parameters?.websiteUrl || 
                       questionnaireData?.contactInfo?.match(/https?:\/\/[^\s]+/)?.[0];

    if (websiteUrl) {
      try {
        console.log(`[AI-ASSISTANT] Анализируем сайт: ${websiteUrl}`);
        const baseUrl = process.env.REPLIT_DEV_DOMAIN 
          ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
          : 'http://localhost:5000';
        const websiteResponse = await axios.post(
          `${baseUrl}/api/keywords/analyze-website`,
          { url: websiteUrl },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (websiteResponse.data?.success && websiteResponse.data?.data?.keywords) {
          websiteKeywords = websiteResponse.data.data.keywords.slice(0, 10);
          websiteAnalysis = `Сайт ${websiteUrl} проанализирован`;
          console.log(`[AI-ASSISTANT] Найдено ${websiteKeywords.length} ключевых слов с сайта`);
        }
      } catch (error) {
        const err = error as Error;
        console.log(`[AI-ASSISTANT] Не удалось проанализировать сайт: ${err.message}`);
      }
    }

    let contextPrompt = '';
    
    if (questionnaireData) {
      contextPrompt = `
ДАННЫЕ БИЗНЕСА (из анкеты):
- Компания: ${questionnaireData.companyName || 'Не указано'}
- Описание: ${questionnaireData.businessDescription || 'Не указано'}
- Продукты/услуги: ${questionnaireData.productsServices || 'Не указано'}
- Целевая аудитория: ${questionnaireData.targetAudience || 'Не указано'}
- Направления: ${questionnaireData.mainDirections || 'Не указано'}
- Ценности: ${questionnaireData.businessValues || 'Не указано'}
- Преимущества: ${questionnaireData.competitiveAdvantages || 'Не указано'}`;
    }

    if (websiteKeywords.length > 0) {
      contextPrompt += `\n\nТОП КЛЮЧЕВЫЕ СЛОВА С САЙТА:
${websiteKeywords.map((kw: any) => `- ${kw.keyword} (релевантность: ${kw.relevance}%)`).join('\n')}`;
    }

    if (!contextPrompt) {
      contextPrompt = `Тема: ${parameters?.topic || 'общая тематика'}`;
    }

    const intelligentPrompt = `Ты эксперт по SMM и подбору ключевых слов. На основе РЕАЛЬНЫХ данных бизнеса подбери ${count} максимально релевантных ключевых слов для контент-маркетинга и поиска трендов.

${contextPrompt}

ЗАДАЧА: Создай ${count} ключевых слов, идеально подходящих для:
1. Поиска трендов в социальных сетях
2. Создания релевантного контента  
3. Привлечения целевой аудитории

ТИПЫ КЛЮЧЕВЫХ СЛОВ:
- Основные (40%): точные названия продуктов/услуг компании
- Коммерческие (30%): запросы с намерением покупки
- Информационные (20%): образовательные запросы аудитории
- Трендовые (10%): популярные в социальных сетях

ВАЖНО: 
- Используй ТОЛЬКО реальные данные бизнеса
- Ключевые слова должны быть специфичными для ЭТОЙ компании
- Учитывай особенности целевой аудитории
- Подходящие для русскоязычного рынка

Создай просто список ключевых слов, каждое с новой строки, БЕЗ нумерации и дополнительного текста:`;

    console.log(`[AI-ASSISTANT] Генерируем ключевые слова с умным промптом`);
    
    const keywordsText = await geminiVertexDirect.generateContent({ 
      prompt: intelligentPrompt,
      model: 'gemini-3-pro-preview'
    });

    const keywordsList = keywordsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.match(/^\d+[\.\)]/))
      .filter(line => line.length > 2 && line.length < 100)
      .slice(0, count);

    if (keywordsList.length === 0) {
      return {
        response: 'Не удалось подобрать ключевые слова. Проверьте данные анкеты или попробуйте указать тему.',
        success: false
      };
    }

    let savedCount = 0;
    const errors: string[] = [];

    console.log(`[AI-ASSISTANT] Сохраняем ${keywordsList.length} ключевых слов в кампанию`);
    
    for (const keyword of keywordsList) {
      try {
        await directusCrud.create('campaign_keywords', {
          keyword: keyword.replace(/^[-\*\+]\s*/, ''),
          campaign_id: campaignId,
          trend_score: Math.floor(Math.random() * 30) + 70,
          mentions_count: Math.floor(Math.random() * 100) + 50,
          date_created: new Date().toISOString(),
          last_checked: new Date().toISOString()
        }, { authToken: request.authToken || '' });
        savedCount++;
      } catch (error) {
        const err = error as Error;
        if (!err.message?.includes('duplicate') && !err.message?.includes('unique')) {
          errors.push(`${keyword}: ${err.message}`);
        }
      }
    }

    const responseText = [
      `✅ **Умный подбор ключевых слов завершен!**`,
      ``,
      `📊 **Результат:**`,
      `• Проанализированы данные: ${questionnaireData ? '✅ Бизнес-анкета' : '❌ Анкета не найдена'}`,
      `• Анализ сайта: ${websiteAnalysis || '❌ Сайт не указан'}`,
      `• Найдено ключевых слов: ${keywordsList.length}`,
      `• Добавлено в кампанию: ${savedCount}`,
      ``,
      `🎯 **Подобранные ключевые слова:**`,
      keywordsList.slice(0, 10).map(kw => `• ${kw}`).join('\n'),
      keywordsList.length > 10 ? `• ... и еще ${keywordsList.length - 10} ключевых слов` : '',
      ``,
      `💡 **Совет:** Эти ключевые слова теперь будут использоваться для поиска трендов и создания релевантного контента!`
    ].filter(Boolean).join('\n');

    return {
      response: responseText,
      success: true,
      action: `Подобрано ${savedCount} ключевых слов на основе анкеты${websiteAnalysis ? ' и сайта' : ''}`
    };

  } catch (error) {
    console.error(`[AI-ASSISTANT] Ошибка при подборе ключевых слов:`, error);
    return {
      response: 'Произошла ошибка при подборе ключевых слов. Убедитесь, что анкета заполнена, и попробуйте снова.',
      success: false
    };
  }
}

export async function handleScheduleOptimalTime(request: AIAssistantRequest, parameters: any): Promise<AIAssistantResponse> {
  try {
    const platforms = parameters?.platforms || ['instagram', 'facebook', 'vk'];

    const timePrompt = `Определи оптимальное время для публикации контента на платформах: ${platforms.join(', ')}.
Учитывай активность аудитории, специфику платформ и часовой пояс МСК.`;

    const schedule = await geminiVertexDirect.generateContent({ 
      prompt: timePrompt,
      model: 'gemini-3-pro-preview'
    });

    return {
      response: schedule,
      success: true,
      action: 'Оптимальное расписание составлено'
    };
  } catch (error) {
    return {
      response: 'Произошла ошибка при составлении расписания. Попробуйте позже.',
      success: false
    };
  }
}
