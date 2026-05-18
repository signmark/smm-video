import { storage } from '../storage';
import type { ContentSource, InsertTrendTopic, InsertCampaignTrendTopic } from '@shared/schema';
import { directusApi } from '../lib/directus';
import crypto from 'crypto';
import { apifyService } from './apify';
import axios from 'axios';

export class ContentCrawler {
  async crawlInstagram(source: ContentSource, campaignId: number, userId: string): Promise<InsertTrendTopic[]> {
    try {
      console.log(`Starting Instagram crawling process for source: ${source.name} (${source.url})`);
      console.log(`Campaign ID: ${campaignId}, User ID: ${userId}`);

      // Extract username from URL
      const username = source.url.split('/').pop() || '';
      if (!username) {
        throw new Error('Could not extract Instagram username from URL');
      }

      console.log(`Extracted Instagram username: ${username}`);

      // Run Instagram scraper actor
      const runId = await apifyService.runInstagramScraper(username);
      console.log(`Started Instagram scraping task ${runId} for ${username}`);

      // Wait for the scraping to finish
      await apifyService.waitForRunToFinish(runId);
      console.log(`Scraping task ${runId} completed`);

      // Get results
      const posts = await apifyService.getRunResults(runId);
      console.log(`Retrieved ${posts.length} posts from Instagram for ${username}`);

      const topics = posts.map(post => ({
        directusId: crypto.randomUUID(),
        title: post.caption?.substring(0, 200) || `Пост из ${source.name}`,
        sourceId: source.id,
        campaignId: campaignId,
        reactions: post.likesCount || 0,
        comments: post.commentsCount || 0,
        views: post.viewsCount || 0
      }));

      console.log(`Transformed ${topics.length} posts into trend topics`);
      return topics;

    } catch (error) {
      console.error(`Error crawling Instagram ${source.url}:`, error);
      throw error;
    }
  }

  async crawlSource(source: ContentSource, campaignId: number, userId: string): Promise<InsertTrendTopic[]> {
    console.log(`Crawling source: ${source.name} (${source.type}) for campaign ${campaignId}`);

    if (source.type !== 'instagram') {
      throw new Error('Currently only Instagram sources are supported');
    }

    return this.crawlInstagram(source, campaignId, userId);
  }

  // Метод getUserToken больше не нужен, так как мы не используем DIRECTUS_SERVICE_TOKEN

  // Сохранение трендовой темы через storage API
  private async saveTrendTopicToStorage(topic: InsertCampaignTrendTopic): Promise<void> {
    try {
      await storage.createCampaignTrendTopic(topic);
    } catch (error) {
      console.error(`Error saving trend topic to storage: ${error}`);
      throw error;
    }
  }

  async crawlAllSources(userId: string, campaignId: string, authToken?: string): Promise<void> {
    try {
      console.log(`Starting to crawl sources for user ${userId} and campaign ${campaignId}`);

      // Get sources for this campaign
      const sources = await storage.getContentSources(userId, Number(campaignId));
      console.log(`Found ${sources.length} sources to crawl for campaign ${campaignId}`);

      // Инициализируем сервис Apify с токеном пользователя
      if (authToken) {
        await apifyService.initialize(userId, authToken);
      } else {
        console.warn('No auth token provided for crawling, some features may be limited');
      }

      for (const source of sources) {
        console.log(`Processing source: ${source.name}`);

        // First, try to get trends for this source
        const topics = await this.crawlSource(source, Number(campaignId), userId);

        if (topics.length === 0) {
          console.log(`No trends found for source ${source.name}, skipping task creation`);
          continue;
        }

        try {
          // Save the topics
          for (const topic of topics) {
            console.log(`Saving topic: ${topic.title}`);
            
            // Создаем объект для сохранения в базу данных
            const trendTopic: InsertCampaignTrendTopic = {
              directusId: topic.directusId,
              title: topic.title,
              sourceId: topic.sourceId,
              campaignId: String(topic.campaignId),
              reactions: topic.reactions,
              comments: topic.comments,
              views: topic.views,
              isBookmarked: false
            };
            
            // Сохраняем через storage API
            await this.saveTrendTopicToStorage(trendTopic);
          }

        } catch (error) {
          console.error(`Error saving topics for source ${source.name}:`, error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Error details:', errorMessage);
        }
      }

      console.log(`Finished crawling all sources for campaign ${campaignId}`);
    } catch (error) {
      console.error('Error crawling sources:', error);
      throw error;
    }
  }
}

export const crawler = new ContentCrawler();