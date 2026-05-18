// Исправленная часть функции getPlatformsStats - убрали фильтрацию по created_at

    // Формируем запрос на получение опубликованных постов
    const filter: any = {
      user_id: { _eq: userId },
      status: { _eq: 'published' }
    };
    
    // Добавляем фильтр по кампании, если он указан
    if (campaignId) {
      // Используем только поле campaign_id
      filter.campaign_id = { _eq: campaignId };
    }
    
    // ВАЖНО: Не используем фильтр по created_at, так как нам нужны все публикации
    // для последующей фильтрации по publishedAt в social_platforms