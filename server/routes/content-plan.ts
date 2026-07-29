import { Express, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { storage } from '../storage';
import { generateContentPlan } from '../services/content-plan-generator';

const DIRECTUS_URL = process.env.DIRECTUS_URL;

interface JobState {
  status: 'running' | 'done' | 'error';
  step: string;
  progress: number;
  detail: string;
  result?: any;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, JobState>();

// Cleanup jobs older than 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > 10 * 60 * 1000) jobs.delete(id);
  }
}, 60 * 1000);

export function registerContentPlanRoutes(app: Express) {
  // Start async content plan generation, return jobId immediately
  app.post("/api/content/generate-plan", authenticateUser, async (req, res) => {
    try {
      const { campaignId, settings, selectedTrendTopics, keywords, businessData } = req.body;
      const userId = req.user?.id;
      const userToken = req.user?.token;

      if (!campaignId || !userId) return res.status(400).json({ error: "Отсутствуют параметры" });
      if (!settings?.postsCount || !settings?.period) return res.status(400).json({ error: "Укажите количество постов и период" });

      const jobId = randomUUID();
      jobs.set(jobId, {
        status: 'running',
        step: 'Инициализация',
        progress: 0,
        detail: '',
        createdAt: Date.now()
      });

      // Run generation in background
      (async () => {
        try {
          const result = await generateContentPlan({
            campaignId,
            userId,
            settings,
            selectedTrendTopics: selectedTrendTopics || [],
            keywords: keywords || [],
            businessData: businessData || null,
            userToken,
            onProgress: (step, progress, detail) => {
              const job = jobs.get(jobId);
              if (job) {
                job.step = step;
                job.progress = progress;
                job.detail = detail || '';
              }
            }
          });

          const job = jobs.get(jobId);
          if (job) {
            job.status = result.success ? 'done' : 'error';
            job.step = result.success ? 'Готово' : 'Ошибка';
            job.progress = result.success ? 100 : job.progress;
            job.result = result.data;
            job.error = result.error;
          }
        } catch (e: any) {
          const job = jobs.get(jobId);
          if (job) {
            job.status = 'error';
            job.step = 'Ошибка';
            job.error = e.message;
          }
        }
      })();

      res.json({ jobId });
    } catch (error: any) {
      console.error(`[Content Plan] Ошибка: ${error.message}`);
      res.status(500).json({ error: error.message || "Ошибка генерации контент-плана" });
    }
  });

  // Poll job status
  app.get("/api/content/generate-plan/status/:jobId", authenticateUser, (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Задача не найдена' });
    res.json({
      status: job.status,
      step: job.step,
      progress: job.progress,
      detail: job.detail,
      result: job.result,
      error: job.error
    });
  });

  app.post("/api/content/save-plan", authenticateUser, async (req, res) => {
    try {
      const { campaignId, contentPlan } = req.body;
      const userId = req.user?.id;

      if (!campaignId || !userId || !Array.isArray(contentPlan)) {
        return res.status(400).json({ error: "Некорректный запрос" });
      }

      const savedContent = [];
      for (const item of contentPlan) {
        const savedItem = await storage.createCampaignContent({
          campaignId,
          userId,
          title: item.title || "",
          content: item.content || "",
          contentType: item.contentType || "text",
          scheduledAt: item.scheduledAt ? new Date(item.scheduledAt) : null,
          status: "draft",
          prompt: item.prompt || ""
        });
        savedContent.push(savedItem);
      }

      res.json({ success: true, data: savedContent });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/webhook/trend-topics", async (req, res) => {
    try {
      const { campaignId, trendTopics } = req.body;
      if (!campaignId || !Array.isArray(trendTopics)) return res.status(400).send('Invalid data');
      
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
      for (const topic of trendTopics) {
        await directusApi.post('/items/campaign_trend_topics', {
          title: topic.title,
          campaign_id: campaignId,
          reactions: topic.reactions || 0,
          views: topic.views || 0
        }, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
