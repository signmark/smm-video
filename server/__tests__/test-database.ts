/**
 * Конфигурация тестовой базы данных
 * Настройка изолированной среды для тестирования с минимальными зависимостями
 */

// Мок для Directus операций в тестовой среде
export class TestDatabase {
  private static instance: TestDatabase;
  private mockData: Map<string, any[]> = new Map();
  
  static getInstance(): TestDatabase {
    if (!TestDatabase.instance) {
      TestDatabase.instance = new TestDatabase();
    }
    return TestDatabase.instance;
  }

  constructor() {
    this.initializeTestData();
  }

  private initializeTestData() {
    // Инициализируем тестовые данные для различных коллекций
    this.mockData.set('campaigns', [
      {
        id: '46868c44-c6a4-4bed-accf-9ad07bba790e',
        name: 'Тестовая кампания 1',
        user_id: 'test-user-id',
        status: 'active',
        date_created: '2024-01-01T00:00:00Z'
      }
    ]);

    this.mockData.set('campaign_content', [
      {
        id: 'content-1',
        campaign_id: '46868c44-c6a4-4bed-accf-9ad07bba790e',
        title: 'Тестовый пост 1',
        content: 'Содержимое тестового поста',
        status: 'draft',
        content_type: 'text',
        date_created: '2024-01-01T00:00:00Z'
      }
    ]);

    this.mockData.set('campaign_keywords', [
      {
        id: 'keyword-1',
        campaign_id: '46868c44-c6a4-4bed-accf-9ad07bba790e',
        keyword: 'тестовое ключевое слово',
        weight: 1.0,
        date_created: '2024-01-01T00:00:00Z'
      }
    ]);

    this.mockData.set('users', [
      {
        id: 'test-user-id',
        email: 'test@example.com',
        first_name: 'Тест',
        last_name: 'Пользователь',
        status: 'active'
      }
    ]);
  }

  // Методы для эмуляции Directus CRUD операций
  async create(collection: string, data: any): Promise<any> {
    const items = this.mockData.get(collection) || [];
    const newItem = {
      id: this.generateId(),
      ...data,
      date_created: new Date().toISOString()
    };
    items.push(newItem);
    this.mockData.set(collection, items);
    return newItem;
  }

  async read(collection: string, filter?: any): Promise<any[]> {
    const items = this.mockData.get(collection) || [];
    
    if (!filter) {
      return items;
    }

    // Простая фильтрация для тестов
    return items.filter(item => {
      for (const [key, value] of Object.entries(filter)) {
        if (typeof value === 'object' && value._eq) {
          if (item[key] !== value._eq) return false;
        } else if (item[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  async update(collection: string, id: string, data: any): Promise<any> {
    const items = this.mockData.get(collection) || [];
    const index = items.findIndex(item => item.id === id);
    
    if (index === -1) {
      throw new Error(`Item with id ${id} not found in collection ${collection}`);
    }

    items[index] = { ...items[index], ...data, date_updated: new Date().toISOString() };
    this.mockData.set(collection, items);
    return items[index];
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const items = this.mockData.get(collection) || [];
    const filteredItems = items.filter(item => item.id !== id);
    
    if (filteredItems.length === items.length) {
      return false; // Item not found
    }

    this.mockData.set(collection, filteredItems);
    return true;
  }

  // Вспомогательные методы
  private generateId(): string {
    return 'test-' + Math.random().toString(36).substr(2, 9);
  }

  // Очистка данных между тестами
  clear(): void {
    this.mockData.clear();
    this.initializeTestData();
  }

  // Получение всех данных для отладки
  getAllData(): Map<string, any[]> {
    return new Map(this.mockData);
  }

  // Добавление тестовых данных
  addTestData(collection: string, data: any[]): void {
    this.mockData.set(collection, [...(this.mockData.get(collection) || []), ...data]);
  }

  // Получение одного элемента по ID
  async findById(collection: string, id: string): Promise<any | null> {
    const items = this.mockData.get(collection) || [];
    return items.find(item => item.id === id) || null;
  }

  // Подсчет элементов в коллекции
  count(collection: string, filter?: any): number {
    const items = this.read(collection, filter);
    return Array.isArray(items) ? items.length : 0;
  }
}

// Мок для DirectusCrud сервиса (для тестовой базы данных)
export const testDirectusCrud = {
  testDb: TestDatabase.getInstance(),

  async create(collection: string, data: any, authToken?: string): Promise<any> {
    console.log(`[TEST-DB] Creating in ${collection}:`, data);
    return this.testDb.create(collection, data);
  },

  async read(collection: string, options: any = {}, authToken?: string): Promise<any> {
    console.log(`[TEST-DB] Reading from ${collection} with options:`, options);
    
    const { filter, limit, sort } = options;
    let items = await this.testDb.read(collection, filter);

    // Простая сортировка
    if (sort && Array.isArray(sort)) {
      items.sort((a, b) => {
        for (const sortField of sort) {
          const field = sortField.startsWith('-') ? sortField.slice(1) : sortField;
          const direction = sortField.startsWith('-') ? -1 : 1;
          
          if (a[field] < b[field]) return -1 * direction;
          if (a[field] > b[field]) return 1 * direction;
        }
        return 0;
      });
    }

    // Ограничение количества
    if (limit && limit > 0) {
      items = items.slice(0, limit);
    }

    return { data: items };
  },

  async update(collection: string, id: string, data: any, authToken?: string): Promise<any> {
    console.log(`[TEST-DB] Updating ${collection}/${id}:`, data);
    return this.testDb.update(collection, id, data);
  },

  async delete(collection: string, id: string, authToken?: string): Promise<boolean> {
    console.log(`[TEST-DB] Deleting ${collection}/${id}`);
    return this.testDb.delete(collection, id);
  }
};

// Функция для настройки тестовой базы данных
export function setupTestDatabase() {
  const testDb = TestDatabase.getInstance();
  testDb.clear();
  
  // Возвращаем моки для использования в тестах
  return {
    testDb,
    testDirectusCrud,
    
    // Утилиты для тестов
    addCampaign: (campaign: any) => testDb.addTestData('campaigns', [campaign]),
    addContent: (content: any) => testDb.addTestData('campaign_content', [content]),
    addKeywords: (keywords: any) => testDb.addTestData('campaign_keywords', [keywords]),
    addUser: (user: any) => testDb.addTestData('users', [user]),
    
    // Проверки для assertions
    getCampaignCount: () => testDb.count('campaigns'),
    getContentCount: () => testDb.count('campaign_content'),
    getKeywordCount: () => testDb.count('campaign_keywords'),
    
    // Очистка между тестами
    cleanup: () => testDb.clear()
  };
}