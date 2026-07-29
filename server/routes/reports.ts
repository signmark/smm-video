import { Router, Request, Response } from 'express';
import { generateCampaignReport } from '../services/report-generator';
import { z } from 'zod';
import { authenticateUser } from '../middleware/user-auth';
import { authorizeCampaignAccess, CampaignAccessError } from '../services/campaign-access';

const router = Router();

// Validation schema для запроса на генерацию отчета
const exportQuerySchema = z.object({
  format: z.enum(['pdf', 'excel']),
  from: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid date format for from parameter'
  }),
  to: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid date format for to parameter'
  }),
  locale: z.enum(['ru', 'en', 'es']).optional().default('ru')
});

/**
 * POST /api/reports/:campaignId/export
 * Генерирует отчет по кампании в формате PDF или Excel
 * 
 * Query params:
 * - format: 'pdf' | 'excel' - формат отчета
 * - from: string (ISO date) - начало периода
 * - to: string (ISO date) - конец периода
 * - locale?: 'ru' | 'en' | 'es' - язык отчета (по умолчанию 'ru')
 * 
 * Headers:
 * - Authorization: Bearer <token> - токен доступа пользователя
 */
router.post('/:campaignId/export', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    
    console.log('🔍 [EXPORT-DEBUG] Request received:', {
      campaignId,
      method: req.method,
      url: req.url,
      headers: {
        authorization: req.headers.authorization ? `${req.headers.authorization.substring(0, 20)}...` : 'MISSING',
        'content-type': req.headers['content-type'],
        origin: req.headers.origin,
        referer: req.headers.referer
      },
      query: req.query,
      body: req.body
    });
    
    // Валидация query параметров
    const validationResult = exportQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.log('❌ [EXPORT-DEBUG] Validation failed:', validationResult.error.errors);
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: validationResult.error.errors
      });
    }

    const { format, from, to, locale } = validationResult.data;

    // Проверяем авторизацию  
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ [EXPORT-DEBUG] Authorization header missing or invalid');
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }

    const accessToken = authHeader.substring(7);

    // Доступ к кампании проверяем ЯВНО. Собственный токен пользователя границей
    // не является: роль в Directus читает данные кампаний целиком, поэтому по
    // чужому campaignId выгружался чужой отчёт — с постами, охватами и
    // комментариями (та же дыра, что закрыта в остальных ручках 2026-07-28).
    try {
      await authorizeCampaignAccess(
        campaignId,
        (req as any).user?.id,
        (req as any).user?.token || accessToken,
        (req as any).user?.is_smm_admin === true,
      );
    } catch (accessErr: any) {
      if (accessErr instanceof CampaignAccessError && accessErr.status === 503) {
        return res.status(503).json({ error: 'Проверка доступа временно недоступна' });
      }
      // 404, а не 403: не подтверждаем существование чужой кампании.
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Конвертируем строки дат в объекты Date
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Проверяем что период валидный
    if (fromDate > toDate) {
      return res.status(400).json({
        error: 'Invalid date range: from date must be before to date'
      });
    }

    console.log(`📊 Generating ${format.toUpperCase()} report for campaign ${campaignId}`);
    console.log(`📅 Period: ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    // Генерируем отчет
    const reportBuffer = await generateCampaignReport(
      campaignId,
      format,
      fromDate,
      toDate,
      accessToken,
      locale
    );

    // Устанавливаем заголовки для скачивания файла
    const filename = `report_${campaignId}_${from}_${to}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
    const contentType = format === 'pdf' 
      ? 'application/pdf' 
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', reportBuffer.length);

    console.log(`✅ Report generated successfully: ${filename} (${reportBuffer.length} bytes)`);

    // Отправляем файл
    res.send(reportBuffer);

  } catch (error: any) {
    console.error('❌ Error generating report:', error);
    
    // Обрабатываем разные типы ошибок
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (error.response && error.response.status === 403) {
      return res.status(403).json({ error: 'Access denied to campaign data' });
    }

    res.status(500).json({
      error: 'Failed to generate report',
      message: error.message
    });
  }
});

export default router;
