import axios from 'axios';
import { apiKeyService } from './api-keys';
import { log } from '../utils/logger';

interface ApifyRunResponse {
  id: string;
  actId: string;
  status: string;
}

interface ApifyRunResult {
  items: any[];
}

export class ApifyService {
  private apiKey: string | null = null;
  private readonly baseUrl = 'https://api.apify.com/v2';

  async initialize(userId: string, authToken?: string) {
    try {
      log(`Initializing Apify service for user: ${userId}`, 'apify');

      // Получаем API ключ из централизованного сервиса ключей
      const apiKey = await apiKeyService.getApiKey(userId, 'apify', authToken);
      
      if (apiKey) {
        this.apiKey = apiKey;
        log('Apify API key successfully obtained', 'apify');
        return true;
      }
      
      log('Apify API key not found', 'apify');
      return false;
      
      /* Старый код для получения API ключа напрямую из Directus
      // Get API key from user settings
      const response = await directusApi.get('/items/user_api_keys', {
        params: {
          filter: {
            user_id: { _eq: userId },
            service_name: { _eq: 'apify' }
          },
          fields: ['api_key']
        },
        headers: authToken ? {
          'Authorization': `Bearer ${authToken}`
        } : undefined
      });

      if (!response.data?.data?.[0]?.api_key) {
        throw new Error('Apify API key not found in user settings');
      }

      this.apiKey = response.data.data[0].api_key;
      console.log('Successfully initialized Apify service with API key from settings');
      */
    } catch (error) {
      console.error('Error getting Apify API key:', error);
      throw error;
    }
  }

  async runInstagramScraper(username: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Apify API key not initialized');
    }

    try {
      log(`Starting Instagram scraper for username: ${username}`, 'apify');

      // Simplified request body matching screenshot example
      const requestData = {
        username: [username],
        resultsLimit: 10
      };

      log('Apify API Request: ' + JSON.stringify({
        url: `${this.baseUrl}/acts/zuzka~instagram-post-scraper/runs`,
        data: requestData
      }), 'apify');

      const response = await axios.post(
        `${this.baseUrl}/acts/zuzka~instagram-post-scraper/runs`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      log('Apify API Response status: ' + response.status, 'apify');

      const runData = response.data as ApifyRunResponse;
      log('Run created with ID: ' + runData.id, 'apify');
      return runData.id;
    } catch (error) {
      log('Error running Instagram scraper: ' + error, 'apify');
      if (axios.isAxiosError(error) && error.response) {
        log('Apify API error response: ' + JSON.stringify(error.response.data), 'apify');
      }
      throw error;
    }
  }

  async getRunStatus(runId: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Apify API key not initialized');
    }

    try {
      log(`Checking status for run ${runId}`, 'apify');
      const response = await axios.get(
        `${this.baseUrl}/actor-runs/${runId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      log(`Run ${runId} status: ${response.data.status}`, 'apify');
      return response.data.status;
    } catch (error) {
      log('Error getting run status: ' + error, 'apify');
      if (axios.isAxiosError(error) && error.response) {
        log('Apify API error response: ' + JSON.stringify(error.response.data), 'apify');
      }
      throw error;
    }
  }

  async getRunResults(runId: string): Promise<any[]> {
    if (!this.apiKey) {
      throw new Error('Apify API key not initialized');
    }

    try {
      log(`Fetching results for run ${runId}`, 'apify');
      const response = await axios.get(
        `${this.baseUrl}/actor-runs/${runId}/dataset/items`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const results = response.data as ApifyRunResult;
      log(`Retrieved ${results.items.length} items from run ${runId}`, 'apify');
      return results.items;
    } catch (error) {
      log('Error getting run results: ' + error, 'apify');
      if (axios.isAxiosError(error) && error.response) {
        log('Apify API error response: ' + JSON.stringify(error.response.data), 'apify');
      }
      throw error;
    }
  }

  async waitForRunToFinish(runId: string, checkInterval = 5000): Promise<void> {
    log(`Waiting for run ${runId} to finish`, 'apify');
    while (true) {
      const status = await this.getRunStatus(runId);
      log(`Current status for run ${runId}: ${status}`, 'apify');

      if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED') {
        if (status !== 'SUCCEEDED') {
          throw new Error(`Run ${runId} failed with status: ${status}`);
        }
        log(`Run ${runId} completed successfully`, 'apify');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
}

export const apifyService = new ApifyService();