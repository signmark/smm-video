/**
 * Настройка тестового окружения
 * Содержит общие моки и утилиты для тестирования
 */

import axios from 'axios';
import { DirectusAuthManager } from '../services/directus-auth-manager';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Загружаем переменные окружения из .env файла
dotenv.config({ path: path.join(__dirname, '../../.env') });
// Для совместимости с Jest и Vitest
const g = global as any;
const vi = g.vi || g.jest;
const beforeAll = g.beforeAll;
const afterAll = g.afterAll;

// Настройки окружения и константы для тестов
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_PASSWORD = 'test_password';
const TEST_USER_ID = 'test-user-id';
const TEST_ADMIN_EMAIL = 'admin@example.com';
const TEST_ADMIN_PASSWORD = 'admin_password';
const TEST_ADMIN_ID = 'test-admin-id';
const TEST_DIRECTUS_URL = 'https://test-directus.example.com';

// Экспортируем объект настроек
export const config = {
  userEmail: TEST_USER_EMAIL,
  userPassword: TEST_USER_PASSWORD,
  userId: TEST_USER_ID,
  adminEmail: TEST_ADMIN_EMAIL,
  adminPassword: TEST_ADMIN_PASSWORD,
  adminId: TEST_ADMIN_ID,
  directusUrl: TEST_DIRECTUS_URL,
  testImagesDir: path.join(__dirname, '../../uploads/test-images'),
};

// Создаем временную директорию для изображений
function setupTestImagesDirectory() {
  try {
    if (!fs.existsSync(config.testImagesDir)) {
      fs.mkdirSync(config.testImagesDir, { recursive: true });
    }

    // Создаем тестовые изображения
    const testImagePaths = [
      path.join(config.testImagesDir, 'test-image-1.jpg'),
      path.join(config.testImagesDir, 'test-image-2.jpg'),
      path.join(config.testImagesDir, 'test-image-3.jpg'),
    ];

    testImagePaths.forEach((imagePath, index) => {
      if (!fs.existsSync(imagePath)) {
        fs.writeFileSync(imagePath, `This is a fake image content for test ${index + 1}`);
      }
    });

    return testImagePaths;
  } catch (error) {
    console.error('Ошибка при создании тестовых изображений:', error);
    return [];
  }
}

// Мокируем ответ для аутентификации в Directus
export const mockAuthResponse = {
  data: {
    access_token: 'test_access_token',
    refresh_token: 'test_refresh_token',
    expires: 900000,
  }
};

// Мок для DirectusAuthManager
export class MockDirectusAuthManager {
  private static instance: MockDirectusAuthManager;
  private adminToken: string | null = null;
  private userTokens: Map<string, string> = new Map();

  static getInstance(): MockDirectusAuthManager {
    if (!MockDirectusAuthManager.instance) {
      MockDirectusAuthManager.instance = new MockDirectusAuthManager();
    }
    return MockDirectusAuthManager.instance;
  }

  async login(email: string, password: string): Promise<{ success: boolean; token?: string }> {
    return { success: true, token: 'test_token' };
  }

  async loginAdmin(): Promise<{ success: boolean; token?: string }> {
    this.adminToken = 'test_admin_token';
    return { success: true, token: this.adminToken };
  }

  getToken(userId: string): string {
    return this.userTokens.get(userId) || 'test_token';
  }

  getAdminToken(): string {
    return this.adminToken || 'test_admin_token';
  }

  clearTokens(): void {
    this.adminToken = null;
    this.userTokens.clear();
  }
}
(global as any).MockDirectusAuthManager = MockDirectusAuthManager;

if (g.jest) {
  g.jest.mock('axios', () => {
    const g2 = global as any;
    const vi2 = g2.vi || g2.jest;
    const m = {
      get: vi2.fn(() => Promise.resolve({ data: {} })),
      post: vi2.fn(() => Promise.resolve({ data: {} })),
      patch: vi2.fn(() => Promise.resolve({ data: {} })),
      delete: vi2.fn(() => Promise.resolve({ data: {} })),
      create: vi2.fn(function (this: any) { return this; }),
      interceptors: {
        request: { use: vi2.fn(), eject: vi2.fn() },
        response: { use: vi2.fn(), eject: vi2.fn() }
      },
      defaults: { headers: { common: {} } }
    };
    return { default: m, ...m };
  });
  g.jest.mock('../services/directus-auth-manager', () => ({
    DirectusAuthManager: (global as any).MockDirectusAuthManager
  }));
} else if (g.vi) {
  g.vi.mock('axios', () => {
    const g2 = global as any;
    const vi2 = g2.vi || g2.jest;
    const m = {
      get: vi2.fn(() => Promise.resolve({ data: {} })),
      post: vi2.fn(() => Promise.resolve({ data: {} })),
      patch: vi2.fn(() => Promise.resolve({ data: {} })),
      delete: vi2.fn(() => Promise.resolve({ data: {} })),
      create: vi2.fn(function (this: any) { return this; }),
      interceptors: {
        request: { use: vi2.fn(), eject: vi2.fn() },
        response: { use: vi2.fn(), eject: vi2.fn() }
      },
      defaults: { headers: { common: {} } }
    };
    return { default: m, ...m };
  });
  g.vi.mock('../services/directus-auth-manager', () => ({
    DirectusAuthManager: (global as any).MockDirectusAuthManager
  }));
}

const mockedAxios = axios as any;

// Перед началом всех тестов настраиваем окружение
beforeAll(async () => {
  // Устанавливаем переменные окружения для тестов
  process.env.DIRECTUS_URL = TEST_DIRECTUS_URL;
  process.env.DIRECTUS_ADMIN_EMAIL = TEST_ADMIN_EMAIL;
  process.env.DIRECTUS_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

  // Создаем тестовую директорию для изображений
  setupTestImagesDirectory();

  // Сбрасываем счетчики вызовов для моков
  vi.clearAllMocks();
});

// После всех тестов очищаем окружение
afterAll(() => {
  vi.resetModules();
  vi.clearAllMocks();

  // Удаляем тестовую директорию
  try {
    if (fs.existsSync(config.testImagesDir)) {
      const files = fs.readdirSync(config.testImagesDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(config.testImagesDir, file));
      });
      fs.rmdirSync(config.testImagesDir);
    }
  } catch (error) {
    console.error('Ошибка при удалении тестовой директории:', error);
  }
});

// Экспортируем моки для использования в тестах
export const mocks = {
  authManager: MockDirectusAuthManager.getInstance(),
  axios: mockedAxios,
  testImagePaths: setupTestImagesDirectory(),
};

// Добавляем глобальные вспомогательные функции для тестов
(global as any).setupTest = async () => {
  vi.clearAllMocks();
  return {
    authManager: MockDirectusAuthManager.getInstance(),
    testImagePaths: mocks.testImagePaths,
  };
};
