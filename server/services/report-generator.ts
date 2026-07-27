import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { createDirectus, rest, readItem, readItems } from '@directus/sdk';
import { format } from 'date-fns';
import { ru, enUS, es, type Locale } from 'date-fns/locale';
import { getTranslations } from '../locales/reports';
import { flattenPublishedPlatformRows } from './analytics-aggregation';

const locales: Record<string, Locale> = { ru, en: enUS, es };

interface ReportData {
  campaign: any;
  analytics: any[];
  posts: any[];
  comments: any[];
  period: { from: Date; to: Date };
  locale: string;
}

interface ReportStats {
  totalPosts: number;
  totalReach: number;
  totalEngagement: number;
  avgEngagementRate: number;
  audienceGrowth: number;
  topPosts: any[];
  platformStats: Record<string, any>;
  sentimentAnalysis: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

// Вычисление статистики для отчета
function calculateStats(data: ReportData): ReportStats {
  const { posts, comments, analytics } = data;

  const totalPosts = posts.length;
  const totalReach = posts.reduce((sum, post) => sum + (post.reach || 0), 0);
  const totalEngagement = posts.reduce((sum, post) => 
    sum + (post.likes || 0) + (post.comments || 0) + (post.shares || 0), 0
  );
  const avgEngagementRate = totalReach > 0 
    ? ((totalEngagement / totalReach) * 100).toFixed(2) 
    : '0';

  // TOP-5 постов по вовлеченности
  const topPosts = [...posts]
    .sort((a, b) => {
      const engagementA = (a.likes || 0) + (a.comments || 0) + (a.shares || 0);
      const engagementB = (b.likes || 0) + (b.comments || 0) + (b.shares || 0);
      return engagementB - engagementA;
    })
    .slice(0, 5);

  // Статистика по платформам
  const platformStats: Record<string, any> = {};
  posts.forEach(post => {
    if (!post.platform) return;
    
    if (!platformStats[post.platform]) {
      platformStats[post.platform] = {
        posts: 0,
        reach: 0,
        engagement: 0
      };
    }
    
    platformStats[post.platform].posts++;
    platformStats[post.platform].reach += post.reach || 0;
    platformStats[post.platform].engagement += 
      (post.likes || 0) + (post.comments || 0) + (post.shares || 0);
  });

  // Анализ тональности комментариев
  const sentimentAnalysis = {
    positive: comments.filter(c => c.sentiment === 'positive').length,
    negative: comments.filter(c => c.sentiment === 'negative').length,
    neutral: comments.filter(c => c.sentiment === 'neutral').length
  };

  // Рост аудитории (берем из аналитики)
  const audienceGrowth = analytics.reduce((sum, a) => sum + (a.followers_growth || 0), 0);

  return {
    totalPosts,
    totalReach,
    totalEngagement,
    avgEngagementRate: parseFloat(avgEngagementRate),
    audienceGrowth,
    topPosts,
    platformStats,
    sentimentAnalysis
  };
}

// Генерация PDF отчета
export async function generatePDFReport(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Устанавливаем шрифт с поддержкой кириллицы
      // Alpine Linux (production Docker) использует /usr/share/fonts/dejavu/
      // Debian/Ubuntu (development) использует /usr/share/fonts/truetype/dejavu/
      let fontRegular: string;
      let fontBold: string;
      
      try {
        // Пробуем Alpine пути (production)
        fontRegular = '/usr/share/fonts/dejavu/DejaVuSans.ttf';
        fontBold = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';
        doc.font(fontRegular);
      } catch (e) {
        // Fallback на Debian/Ubuntu пути (development)
        fontRegular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        fontBold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
        doc.font(fontRegular);
      }

      const stats = calculateStats(data);
      const locale = locales[data.locale] || ru;
      const t = getTranslations(data.locale);

      // ОБЛОЖКА
      doc.font(fontBold).fontSize(28).fillColor('#1e40af').text(t.branding.productName, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(20).fillColor('#64748b').text(t.cover.title, { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(16).fillColor('#0f172a').text(data.campaign.name || t.common.untitled, { align: 'center' });
      doc.moveDown(0.5);
      
      const periodText = `${format(data.period.from, 'dd MMMM yyyy', { locale })} - ${format(data.period.to, 'dd MMMM yyyy', { locale })}`;
      doc.fontSize(12).fillColor('#64748b').text(periodText, { align: 'center' });
      doc.moveDown(2);

      // Линия разделитель
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e2e8f0');
      doc.moveDown(2);

      // ОСНОВНАЯ СТАТИСТИКА
      doc.font(fontBold).fontSize(16).fillColor('#1e40af').text(`📊 ${t.overview.title}`);
      doc.font(fontRegular);
      doc.moveDown(1);

      const statsData = [
        { label: t.overview.totalPosts, value: stats.totalPosts.toString(), icon: '📝' },
        { label: t.overview.totalViews, value: stats.totalReach.toLocaleString(), icon: '👁️' },
        { label: t.overview.totalLikes + ' + ' + t.overview.totalReposts + ' + ' + t.overview.totalComments, value: stats.totalEngagement.toLocaleString(), icon: '❤️' },
        { label: t.overview.avgEngagement, value: `${stats.avgEngagementRate}%`, icon: '📈' }
      ];

      statsData.forEach((stat, index) => {
        const y = doc.y;
        doc.fontSize(10).fillColor('#64748b').text(stat.icon, 50, y);
        doc.fontSize(10).fillColor('#64748b').text(stat.label, 70, y);
        doc.fontSize(14).fillColor('#0f172a').text(stat.value, 300, y, { align: 'right' });
        doc.moveDown(1.5);
      });

      doc.moveDown(1);

      // СТАТИСТИКА ПО ПЛАТФОРМАМ
      if (Object.keys(stats.platformStats).length > 0) {
        doc.font(fontBold).fontSize(16).fillColor('#1e40af').text(`🌐 ${t.platforms.title}`);
        doc.font(fontRegular);
        doc.moveDown(1);

        Object.entries(stats.platformStats).forEach(([platform, data]: [string, any]) => {
          const y = doc.y;
          doc.fontSize(12).fillColor('#0f172a').text(platform.toUpperCase(), 50, y);
          doc.fontSize(10).fillColor('#64748b').text(
            `${data.posts} ${t.platforms.posts.toLowerCase()} | ${data.reach.toLocaleString()} ${t.platforms.views.toLowerCase()} | ${data.engagement.toLocaleString()} ${t.platforms.engagement.toLowerCase()}`,
            50, y + 15
          );
          doc.moveDown(2);
        });

        doc.moveDown(1);
      }

      // ТОП-5 ПОСТОВ
      if (stats.topPosts.length > 0) {
        doc.addPage();
        doc.font(fontBold).fontSize(16).fillColor('#1e40af').text(`🏆 ${t.topPosts.title}`);
        doc.font(fontRegular);
        doc.moveDown(1);

        stats.topPosts.forEach((post, index) => {
          const engagement = (post.likes || 0) + (post.comments || 0) + (post.shares || 0);
          
          doc.fontSize(12).fillColor('#0f172a').text(`${index + 1}. ${post.title || t.common.untitled}`);
          doc.fontSize(10).fillColor('#64748b').text(
            `${post.platform || t.common.notAvailable} | ${engagement} ${t.topPosts.engagement.toLowerCase()} | ${post.reach || 0} ${t.topPosts.views.toLowerCase()}`,
            { indent: 20 }
          );
          
          if (post.content) {
            const preview = post.content.substring(0, 150) + (post.content.length > 150 ? '...' : '');
            doc.fontSize(9).fillColor('#94a3b8').text(preview, { indent: 20 });
          }
          
          doc.moveDown(1.5);
        });
      }

      // АНАЛИЗ КОММЕНТАРИЕВ
      if (data.comments.length > 0) {
        doc.addPage();
        doc.font(fontBold).fontSize(16).fillColor('#1e40af').text(`💬 ${t.sentiment.title}`);
        doc.font(fontRegular);
        doc.moveDown(1);

        const total = data.comments.length;
        const positivePercent = total > 0 ? ((stats.sentimentAnalysis.positive / total) * 100).toFixed(1) : '0';
        const negativePercent = total > 0 ? ((stats.sentimentAnalysis.negative / total) * 100).toFixed(1) : '0';
        const neutralPercent = total > 0 ? ((stats.sentimentAnalysis.neutral / total) * 100).toFixed(1) : '0';

        doc.fontSize(12).fillColor('#22c55e').text(`✅ ${t.sentiment.positive}: ${stats.sentimentAnalysis.positive} (${positivePercent}%)`);
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor('#ef4444').text(`❌ ${t.sentiment.negative}: ${stats.sentimentAnalysis.negative} (${negativePercent}%)`);
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor('#94a3b8').text(`➖ ${t.sentiment.neutral}: ${stats.sentimentAnalysis.neutral} (${neutralPercent}%)`);
        doc.moveDown(2);

        doc.fontSize(10).fillColor('#64748b').text(`${t.sentiment.totalComments}: ${total}`);
      }

      // FOOTER
      doc.fontSize(8).fillColor('#94a3b8').text(
        `${t.cover.generatedAt} ${format(new Date(), 'dd MMMM yyyy в HH:mm', { locale })} | ${t.footer.generatedBy}`,
        50,
        doc.page.height - 50,
        { align: 'center' }
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Генерация Excel отчета
export async function generateExcelReport(data: ReportData): Promise<Buffer> {
  const stats = calculateStats(data);
  const t = getTranslations(data.locale);
  const wb = XLSX.utils.book_new();

  // ЛИСТ 1: Общая статистика
  const summaryData = [
    [t.cover.title, data.campaign.name || t.common.untitled],
    [t.cover.period, `${format(data.period.from, 'dd.MM.yyyy')} - ${format(data.period.to, 'dd.MM.yyyy')}`],
    [t.cover.generatedAt, format(new Date(), 'dd.MM.yyyy HH:mm')],
    [],
    [t.excel.title, t.excel.comment],
    [t.overview.totalPosts, stats.totalPosts],
    [t.overview.totalViews, stats.totalReach],
    [t.overview.avgEngagement, stats.totalEngagement],
    [t.overview.avgEngagement + ' (%)', stats.avgEngagementRate]
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1['!cols'] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws1, t.excel.overview);

  // ЛИСТ 2: Посты
  const postsData = [
    [t.excel.title, t.topPosts.platform, t.excel.publishedAt, t.topPosts.views, t.topPosts.likes, t.overview.totalComments, t.overview.totalReposts, t.topPosts.engagement, t.overview.avgEngagement + ' (%)']
  ];
  data.posts.forEach(post => {
    const engagement = (post.likes || 0) + (post.comments || 0) + (post.shares || 0);
    const er = post.reach > 0 ? ((engagement / post.reach) * 100).toFixed(2) : '0';
    
    postsData.push([
      post.title || t.common.untitled,
      post.platform || t.common.notAvailable,
      post.published_at ? format(new Date(post.published_at), 'dd.MM.yyyy HH:mm') : '',
      post.reach || 0,
      post.likes || 0,
      post.comments || 0,
      post.shares || 0,
      engagement,
      er
    ]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(postsData);
  ws2['!cols'] = [
    { wch: 30 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, 
    { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 8 }
  ];
  XLSX.utils.book_append_sheet(wb, ws2, t.excel.posts);

  // ЛИСТ 3: Платформы
  const platformsData = [[t.topPosts.platform, t.platforms.posts, t.platforms.views, t.platforms.engagement]];
  Object.entries(stats.platformStats).forEach(([platform, data]: [string, any]) => {
    platformsData.push([platform, data.posts, data.reach, data.engagement]);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(platformsData);
  ws3['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws3, t.excel.platforms);

  // ЛИСТ 4: Комментарии
  if (data.comments.length > 0) {
    const commentsData = [[t.excel.title, t.excel.comment, t.topPosts.platform, t.excel.publishedAt, t.excel.sentimentScore]];
    data.comments.forEach(comment => {
      commentsData.push([
        comment.author || t.common.anonymous,
        comment.text || '',
        comment.platform || t.common.notAvailable,
        comment.created_at ? format(new Date(comment.created_at), 'dd.MM.yyyy HH:mm') : '',
        comment.sentiment || t.common.notAvailable
      ]);
    });
    const ws4 = XLSX.utils.aoa_to_sheet(commentsData);
    ws4['!cols'] = [{ wch: 20 }, { wch: 50 }, { wch: 12 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, t.excel.comments);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Основная функция для получения данных и генерации отчета
export async function generateCampaignReport(
  campaignId: string,
  format: 'pdf' | 'excel',
  fromDate: Date,
  toDate: Date,
  accessToken: string,
  locale: string = 'ru'
): Promise<Buffer> {
  const axios = (await import('axios')).default;
  const { directusCrud } = await import('./directus-crud');

  // Получаем данные кампании
  const campaign = await directusCrud.getById('user_campaigns', campaignId, {
    authToken: accessToken
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  // Получаем контент кампании. Фильтр по периоду и метрики берём НЕ из
  // top-level колонок (published_at/reach/likes обычно пустые), а из JSON
  // social_platforms — тем же способом, что и страница аналитики. Иначе отчёт
  // выгружается пустым, хотя на странице посты есть.
  const rawPosts = await directusCrud.list('campaign_content', {
    authToken: accessToken,
    filter: {
      campaign_id: { _eq: campaignId },
      status: { _in: ['published', 'partially_published', 'partial'] }
    },
    limit: -1
  });

  const posts = flattenPublishedPlatformRows(rawPosts, fromDate, toDate);

  // Получаем комментарии (опционально, если нет прав - пустой массив)
  let comments: any[] = [];
  try {
    comments = await directusCrud.list('comments', {
      authToken: accessToken,
      filter: {
        campaign_id: { _eq: campaignId },
        created_at: {
          _between: [fromDate.toISOString(), toDate.toISOString()]
        }
      },
      limit: -1
    });
  } catch (error: any) {
    if (error.response && (error.response.status === 403 || error.response.status === 404)) {
      console.log('⚠️ [REPORT] No access to comments collection or no comments found, using empty array');
      comments = [];
    } else {
      throw error;
    }
  }

  // Рост аудитории по коллекции analytics здесь не считаем (followers_growth в
  // потоке публикаций отсутствует) — оставляем пустым, метрики уже в posts.
  const analytics: any[] = [];

  const reportData: ReportData = {
    campaign,
    analytics,
    posts,
    comments,
    period: { from: fromDate, to: toDate },
    locale
  };

  if (format === 'pdf') {
    return generatePDFReport(reportData);
  } else {
    return generateExcelReport(reportData);
  }
}
