/**
 * Получает агрегированную статистику по платформам
 * @param userId ID пользователя
 * @param campaignId ID кампании
 * @param period Период, за который нужно получить данные (в днях)
 * @returns Промис с агрегированной статистикой по платформам
 */
export async function getPlatformsStats(userId: string, campaignId?: string, period: number = 7): Promise<{
  platforms: Record<string, any>,
  aggregated: AggregatedMetrics
}> {
  try {
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
    
    // Получаем все опубликованные посты с использованием прямого axios запроса
    let posts = [];
    try {
      // Получаем токен администратора
      const adminSession = await directusAuthManager.getAdminSession();
      const token = adminSession ? adminSession.token : null;
      
      if (!token) {
        throw new Error('Не удалось получить токен для запроса постов');
      }
      
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      
      // Делаем запрос через axios
      const response = await axios.get(`${directusUrl}/items/campaign_content`, {
        params: {
          filter,
          fields: ['id', 'campaign_id', 'social_platforms', 'created_at']
        },
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      posts = response.data?.data || [];
      log.info(`[analytics-service] Получено ${posts.length} постов для статистики. Кампания: ${campaignId}, период: ${period} дней`);
      
      // Добавляем детальное логирование для отладки
      posts.forEach((post, index) => {
        log.info(`[analytics-service] Пост ${index + 1}: ID=${post.id}, created_at=${post.created_at}`);
      });
      
      // Фильтруем посты по дате publishedAt из social_platforms
      if (period > 0) {
        const periodStartDate = new Date();
        periodStartDate.setDate(periodStartDate.getDate() - period);
        
        // Создаем новый массив с фильтрацией по дате публикации
        const filteredPosts = posts.filter(post => {
          if (!post.social_platforms) return false;
          
          // Проверяем, что хотя бы одна платформа опубликована в указанный период
          return Object.values(post.social_platforms).some((platformData: any) => {
            if (platformData.status !== 'published' || !platformData.publishedAt) return false;
            
            const publishedAt = new Date(platformData.publishedAt);
            return publishedAt >= periodStartDate;
          });
        });
        
        log.info(`[analytics-service] Отфильтровано по publishedAt: ${filteredPosts.length} постов из ${posts.length}`);
        posts = filteredPosts;
      }
    } catch (error) {
      log.error(`[analytics-service] Ошибка при получении постов: ${error.message}`);
      // В случае ошибки возвращаем пустой массив
      posts = [];
    }
    
    // Начальные значения для агрегированных метрик
    const aggregated: AggregatedMetrics = {
      totalPosts: 0, // Будем считать количество публикаций как сумму публикаций на всех платформах
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalEngagement: 0,
      averageEngagementRate: 0,
      platformDistribution: {}
    };
    
    // Статистика по каждой платформе
    const platformStats: Record<string, any> = {
      telegram: {
        posts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagement: 0
      },
      vk: {
        posts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagement: 0
      },
      instagram: {
        posts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagement: 0
      },
      facebook: {
        posts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagement: 0
      }
    };
    
    // Обрабатываем каждый пост
    posts.forEach(post => {
      if (!post.social_platforms) return;
      
      // Обрабатываем каждую платформу
      Object.keys(post.social_platforms).forEach(platform => {
        const platformData = post.social_platforms[platform];
        
        // Пропускаем, если платформа не опубликована или нет аналитики
        if (platformData.status !== 'published' || !platformData.analytics) {
          return;
        }
        
        // Увеличиваем счетчик постов для платформы
        platformStats[platform].posts++;
        
        // Суммируем метрики
        const views = platformData.analytics.views || 0;
        const likes = platformData.analytics.likes || 0;
        const comments = platformData.analytics.comments || 0;
        const shares = platformData.analytics.shares || 0;
        const engagement = likes + comments + shares;
        
        platformStats[platform].views += views;
        platformStats[platform].likes += likes;
        platformStats[platform].comments += comments;
        platformStats[platform].shares += shares;
        platformStats[platform].engagement += engagement;
        
        // Добавляем к общим метрикам
        aggregated.totalViews += views;
        aggregated.totalLikes += likes;
        aggregated.totalComments += comments;
        aggregated.totalShares += shares;
        aggregated.totalEngagement += engagement;
      });
    });
    
    // Подсчитываем общее количество публикаций и вычисляем коэффициенты вовлеченности
    let totalPlatformPosts = 0;
    
    Object.keys(platformStats).forEach(platform => {
      const stats = platformStats[platform];
      // Суммируем количество публикаций на всех платформах
      totalPlatformPosts += stats.posts;
      // Вычисляем коэффициент вовлеченности для каждой платформы
      stats.engagementRate = stats.views > 0 ? (stats.engagement / stats.views) * 100 : 0;
    });
    
    // Обновляем общее количество публикаций (важно - это сумма всех публикаций на платформах)
    aggregated.totalPosts = totalPlatformPosts;
    
    // Вычисляем средний коэффициент вовлеченности
    aggregated.averageEngagementRate = aggregated.totalViews > 0 ? 
      (aggregated.totalEngagement / aggregated.totalViews) * 100 : 0;
    
    // Заполняем распределение по платформам
    aggregated.platformDistribution = platformStats;
    
    log.info(`[analytics-service] Итоговое количество публикаций: ${totalPlatformPosts} (сумма по всем платформам)`);
    
    return {
      platforms: platformStats,
      aggregated
    };
  } catch (error: any) {
    log.error(`[analytics-service] Ошибка получения статистики платформ: ${error.message}`);
    return {
      platforms: {},
      aggregated: {
        totalPosts: 0,
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalEngagement: 0,
        averageEngagementRate: 0,
        platformDistribution: {}
      }
    };
  }
}