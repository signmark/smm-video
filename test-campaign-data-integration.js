/**
 * Автотесты для проверки интеграции данных кампании во всех AI сервисах
 * Проверяет, что функция "Использовать данные кампании" работает корректно
 */

import axios from 'axios';

// Конфигурация тестов
const CONFIG = {
  baseUrl: 'http://localhost:5000',
  directusUrl: 'https://directus.nplanner.ru',
  credentials: {
    email: 'lbrspb@gmail.com',
    password: 'QtpZ3dh7'
  },
  authToken: null, // Будет получен автоматически
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
  timeout: 30000
};

/**
 * Получает свежий токен авторизации от Directus
 */
async function getFreshAuthToken() {
  try {
    console.log('🔑 Получение свежего токена авторизации...');
    
    const response = await axios.post(`${CONFIG.directusUrl}/auth/login`, {
      email: CONFIG.credentials.email,
      password: CONFIG.credentials.password
    });
    
    if (response.data && response.data.data && response.data.data.access_token) {
      const token = response.data.data.access_token;
      CONFIG.authToken = token;
      console.log('✅ Токен успешно получен');
      return token;
    } else {
      throw new Error('Неверная структура ответа от Directus');
    }
  } catch (error) {
    console.error('❌ Ошибка получения токена:', error.message);
    throw error;
  }
}

// Тестовые AI сервисы
const AI_SERVICES = [
  { name: 'Claude', service: 'claude' },
  { name: 'Gemini', service: 'gemini-2.0-flash' },
  { name: 'Qwen', service: 'qwen' },
  { name: 'DeepSeek', service: 'deepseek' }
];

// Ожидаемые индикаторы успешного использования данных кампании
const CAMPAIGN_DATA_INDICATORS = [
  'nplanner.ru',
  'NPlanner',
  'здоровое питание',
  'правильное питание',
  'план питания'
];

// Индикаторы выдуманных данных (которых быть не должно)
const FAKE_DATA_INDICATORS = [
  'example.com',
  'planster.com',
  'yoursite.com',
  'website.com',
  'компания.рф'
];

class CampaignDataTester {
  constructor() {
    this.results = [];
    this.totalTests = 0;
    this.passedTests = 0;
  }

  async makeRequest(service, useCampaignData = true) {
    try {
      console.log(`\n🔄 Тестируем ${service} с useCampaignData=${useCampaignData}...`);
      
      const response = await axios.post(`${CONFIG.baseUrl}/api/generate-content`, {
        prompt: "Напиши пост про наш сервис с ссылкой на сайт",
        service: service,
        useCampaignData: useCampaignData,
        campaignId: CONFIG.campaignId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.authToken}`
        },
        timeout: CONFIG.timeout
      });

      return {
        success: true,
        content: response.data.content,
        service: response.data.service
      };
    } catch (error) {
      console.error(`❌ Ошибка запроса к ${service}:`, error.message);
      return {
        success: false,
        error: error.message,
        service: service
      };
    }
  }

  analyzeContent(content, serviceName) {
    const analysis = {
      hasCampaignData: false,
      hasFakeData: false,
      campaignIndicators: [],
      fakeIndicators: [],
      contentLength: content ? content.length : 0
    };

    if (!content) {
      return analysis;
    }

    const contentLower = content.toLowerCase();

    // Проверяем наличие данных кампании
    CAMPAIGN_DATA_INDICATORS.forEach(indicator => {
      if (contentLower.includes(indicator.toLowerCase())) {
        analysis.hasCampaignData = true;
        analysis.campaignIndicators.push(indicator);
      }
    });

    // Проверяем наличие выдуманных данных
    FAKE_DATA_INDICATORS.forEach(indicator => {
      if (contentLower.includes(indicator.toLowerCase())) {
        analysis.hasFakeData = true;
        analysis.fakeIndicators.push(indicator);
      }
    });

    return analysis;
  }

  async testService(serviceConfig) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🧪 ТЕСТИРУЕМ ${serviceConfig.name.toUpperCase()}`);
    console.log(`${'='.repeat(50)}`);

    const testResult = {
      serviceName: serviceConfig.name,
      service: serviceConfig.service,
      withCampaignData: null,
      withoutCampaignData: null,
      passed: false,
      issues: []
    };

    // Тест 1: С данными кампании
    console.log('\n📊 Тест 1: С использованием данных кампании');
    const withCampaignData = await this.makeRequest(serviceConfig.service, true);
    testResult.withCampaignData = withCampaignData;

    if (withCampaignData.success) {
      const analysis = this.analyzeContent(withCampaignData.content, serviceConfig.name);
      console.log(`✅ Контент сгенерирован (${analysis.contentLength} символов)`);
      
      if (analysis.hasCampaignData) {
        console.log(`✅ Найдены данные кампании: ${analysis.campaignIndicators.join(', ')}`);
      } else {
        console.log(`❌ Данные кампании НЕ найдены`);
        testResult.issues.push('Отсутствуют данные кампании');
      }

      if (analysis.hasFakeData) {
        console.log(`❌ Найдены выдуманные данные: ${analysis.fakeIndicators.join(', ')}`);
        testResult.issues.push(`Выдуманные данные: ${analysis.fakeIndicators.join(', ')}`);
      } else {
        console.log(`✅ Выдуманные данные отсутствуют`);
      }

      // Показываем фрагмент контента
      console.log(`📝 Фрагмент: ${withCampaignData.content.substring(0, 150)}...`);
    } else {
      console.log(`❌ Ошибка генерации: ${withCampaignData.error}`);
      testResult.issues.push(`Ошибка API: ${withCampaignData.error}`);
    }

    // Тест 2: Без данных кампании (для сравнения)
    console.log('\n📊 Тест 2: Без использования данных кампании');
    const withoutCampaignData = await this.makeRequest(serviceConfig.service, false);
    testResult.withoutCampaignData = withoutCampaignData;

    if (withoutCampaignData.success) {
      const analysis = this.analyzeContent(withoutCampaignData.content, serviceConfig.name);
      console.log(`✅ Контент сгенерирован (${analysis.contentLength} символов)`);
      console.log(`📝 Фрагмент: ${withoutCampaignData.content.substring(0, 150)}...`);
    }

    // Определяем результат теста
    if (withCampaignData.success && testResult.issues.length === 0) {
      testResult.passed = true;
      console.log(`\n🎉 ${serviceConfig.name} ПРОШЕЛ ТЕСТ`);
      this.passedTests++;
    } else {
      console.log(`\n❌ ${serviceConfig.name} НЕ ПРОШЕЛ ТЕСТ`);
      if (testResult.issues.length > 0) {
        console.log(`Проблемы: ${testResult.issues.join(', ')}`);
      }
    }

    this.totalTests++;
    this.results.push(testResult);
    return testResult;
  }

  async runAllTests() {
    console.log('🚀 ЗАПУСК АВТОТЕСТОВ ИНТЕГРАЦИИ ДАННЫХ КАМПАНИИ');
    console.log(`⏰ Timeout: ${CONFIG.timeout}ms`);
    console.log(`🎯 Campaign ID: ${CONFIG.campaignId}`);
    
    // Получаем свежий токен авторизации перед запуском тестов
    try {
      await getFreshAuthToken();
    } catch (error) {
      console.error('💥 Не удалось получить токен авторизации. Тесты остановлены.');
      return;
    }
    
    const startTime = Date.now();

    for (const serviceConfig of AI_SERVICES) {
      await this.testService(serviceConfig);
      // Небольшая пауза между тестами
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.printSummary();
    
    const endTime = Date.now();
    console.log(`\n⏱️  Время выполнения: ${(endTime - startTime) / 1000}s`);
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 ИТОГОВЫЙ ОТЧЕТ');
    console.log('='.repeat(60));
    
    console.log(`✅ Прошли тест: ${this.passedTests}/${this.totalTests}`);
    console.log(`❌ Не прошли тест: ${this.totalTests - this.passedTests}/${this.totalTests}`);
    
    console.log('\n📋 ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ:');
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.serviceName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
      
      if (!result.passed && result.issues.length > 0) {
        result.issues.forEach(issue => {
          console.log(`   ⚠️  ${issue}`);
        });
      }
    });

    if (this.passedTests === this.totalTests) {
      console.log('\n🎉 ВСЕ ТЕСТЫ ПРОШЛИ УСПЕШНО!');
      console.log('✅ Функция "Использовать данные кампании" работает корректно во всех AI сервисах');
    } else {
      console.log('\n⚠️  ЕСТЬ ПРОБЛЕМЫ, ТРЕБУЮЩИЕ ИСПРАВЛЕНИЯ');
      console.log('🔧 Необходимо исправить неработающие сервисы');
    }
  }
}

// Запуск тестов
async function main() {
  const tester = new CampaignDataTester();
  await tester.runAllTests();
}

// Запуск тестов
main().catch(console.error);

export { CampaignDataTester, CONFIG, AI_SERVICES };