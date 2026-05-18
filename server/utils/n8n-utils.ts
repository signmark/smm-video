import axios from 'axios';

// Кэш для URL чтобы не логировать каждый раз
let cachedN8nUrl: string | null = null;

/**
 * Получает N8N URL из переменных окружения
 * Replit (dev) → n8n.roboflow.space
 * Docker (production) → n8n.nplanner.ru (через N8N_URL env)
 */
export function getN8nUrl(): string {
  if (cachedN8nUrl) {
    return cachedN8nUrl;
  }

  cachedN8nUrl = process.env.N8N_URL || 'https://n8n.roboflow.space';
  console.log(`🔗 [N8N-UTILS] Using N8N URL: ${cachedN8nUrl}`);

  return cachedN8nUrl;
}

/**
 * Функция для взаимодействия с n8n API
 */
export async function triggerN8nWorkflow(workflowId: string, data: any): Promise<any> {
  try {
    const n8nUrl = getN8nUrl();
    const n8nApiKey = process.env.N8N_API_KEY;

    if (!n8nUrl) {
      throw new Error('N8N_URL не настроен в переменных окружения');
    }

    if (!n8nApiKey) {
      throw new Error('N8N API ключ не настроен');
    }

    const response = await axios.post(
      `${n8nUrl}/api/v1/workflows/${workflowId}/execute`,
      { data },
      {
        headers: {
          'X-N8N-API-KEY': n8nApiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('Ошибка при вызове N8N workflow:', error.message);
    if (error.response) {
      console.error('Ответ от N8N:', error.response.data);
    }
    throw error;
  }
}
