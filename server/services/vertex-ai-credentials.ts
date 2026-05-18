import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';

/**
 * Сервис для управления учетными данными Vertex AI
 */
export class VertexAICredentialsService {
  private credentialsPath: string;

  constructor() {
    // Создаем папку для хранения учетных данных если она не существует
    const credentialsDir = path.join(process.cwd(), 'config', 'vertex-ai');
    if (!fs.existsSync(credentialsDir)) {
      fs.mkdirSync(credentialsDir, { recursive: true });
    }
    
    this.credentialsPath = path.join(credentialsDir, 'service-account.json');
  }

  /**
   * Сохраняет учетные данные Service Account в файл
   */
  saveCredentials(credentials: any): void {
    try {
      fs.writeFileSync(this.credentialsPath, JSON.stringify(credentials, null, 2));
      logger.log('[vertex-ai-credentials] Учетные данные сохранены');
    } catch (error) {
      logger.error('[vertex-ai-credentials] Ошибка сохранения учетных данных:', error);
      throw new Error('Не удалось сохранить учетные данные Vertex AI');
    }
  }

  /**
   * Загружает учетные данные Service Account из файла
   */
  loadCredentials(): any | null {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const credentialsData = fs.readFileSync(this.credentialsPath, 'utf8');
        return JSON.parse(credentialsData);
      }
      return null;
    } catch (error) {
      logger.error('[vertex-ai-credentials] Ошибка загрузки учетных данных:', error);
      return null;
    }
  }

  /**
   * Проверяет, существуют ли сохраненные учетные данные
   */
  hasCredentials(): boolean {
    return fs.existsSync(this.credentialsPath);
  }

  /**
   * Получает Project ID из сохраненных учетных данных
   */
  getProjectId(): string | null {
    const credentials = this.loadCredentials();
    return credentials ? credentials.project_id : null;
  }

  /**
   * Удаляет сохраненные учетные данные
   */
  removeCredentials(): void {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        fs.unlinkSync(this.credentialsPath);
        logger.log('[vertex-ai-credentials] Учетные данные удалены');
      }
    } catch (error) {
      logger.error('[vertex-ai-credentials] Ошибка удаления учетных данных:', error);
    }
  }
}

// Экспортируем единственный экземпляр
export const vertexAICredentials = new VertexAICredentialsService();

// Автоматическая загрузка учетных данных при запуске
if (vertexAICredentials.hasCredentials()) {
  console.log('✅ Vertex AI credentials загружены успешно');
} else {
  console.log('⚠️ Vertex AI credentials не найдены');
}