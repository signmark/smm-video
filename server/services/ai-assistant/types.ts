export interface AIAssistantRequest {
  message: string;
  userId: string;
  campaignId?: string;
  authToken?: string; // Добавляем токен авторизации
  userToken?: string; // Добавляем userToken для совместимости
  chatHistory?: Array<{role: 'user' | 'assistant'; content: string; timestamp?: Date}>; // История диалога
}

export interface AIAssistantResponse {
  response: string;
  action?: string;
  success: boolean;
  data?: any;
  interactive?: {
    type: 'platform-selector' | 'campaign-options' | 'welcome-tutorial';
    platforms?: Array<{
      id: string;
      name: string;
      enabled: boolean;
    }>;
    campaignOptions?: {
      name: string;
      description: string;
      websiteUrl: string;
      options: Array<{
        id: string;
        name: string;
        description: string;
        enabled: boolean;
      }>;
    };
    tutorial?: {
      currentStep: number;
      totalSteps: number;
      steps: Array<{
        id: string;
        title: string;
        description: string;
        action: string;
        icon: string;
        example?: string;
        command?: string;
      }>;
    };
  };
}

export interface CommandAnalysis {
  intent: 'fill_questionnaire' | 'read_questionnaire' | 'create_posts' | 'create_posts_from_questionnaire' | 
          'create_campaign' | 'schedule_posts' | 'publish_content' | 'generate_image' | 'analyze_campaign' | 
          'create_stories' | 'get_analytics' | 'setup_social_accounts' | 'optimize_content' | 'analyze_trends' | 
          'start_scheduler' | 'stop_scheduler' | 'analyze_competitors' | 'generate_hashtags' | 
          'schedule_optimal_time' | 'collect_trends' | 'manage_content' | 'get_campaign_data' | 'help' | 'unknown';
  confidence: number;
  parameters?: {
    topic?: string;
    name?: string; // Добавляем name для создания кампании
    count?: number;
    platforms?: string[];
    scheduleTime?: string;
    generateImages?: boolean;
    isConnectedSeries?: boolean;
    websiteUrl?: string;
    analysisType?: string;
    optimization?: string;
    hashtagCount?: number;
    timeframe?: string;
  };
}

export interface AvailableFunction {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    default?: any;
    enum?: string[];
  }>;
  examples: string[];
}
