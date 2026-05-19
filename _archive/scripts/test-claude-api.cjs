#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки Claude API на стейдже
 * Использование: node test-claude-api.cjs
 */

const axios = require('axios');
const dotenv = require('dotenv');

// Загружаем переменные окружения
dotenv.config();

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const API_KEY = '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';

// Модели для тестирования (от самой доступной до самой требовательной)
const TEST_MODELS = [
  'claude-3-haiku-20240307',
  'claude-3-sonnet-20240229',
  'claude-3-5-sonnet-20241022'
];

function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

function logError(message) {
  console.log(`[ERROR] ${message}`);
}

function logSuccess(message) {
  console.log(`[SUCCESS] ${message}`);
}

function printEnvironmentInfo() {
  logInfo('=== ENVIRONMENT INFO ===');
  logInfo(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
  logInfo(`Platform: ${process.platform}`);
  logInfo(`Node version: ${process.version}`);
  logInfo(`API URL: ${CLAUDE_API_URL}`);
  logInfo(`API Key (masked): ${API_KEY.substring(0, 8)}...${API_KEY.substring(API_KEY.length - 4)}`);
  console.log('');
}

async function testClaudeModel(model) {
  logInfo(`Testing model: ${model}`);
  
  const requestData = {
    model: model,
    max_tokens: 50,
    messages: [
      {
        role: 'user',
        content: 'Say "Model working" if you can read this message.'
      }
    ]
  };

  try {
    const startTime = Date.now();
    
    const response = await axios.post(CLAUDE_API_URL, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'SMM-Manager-Test/1.0'
      },
      timeout: 30000,
      validateStatus: function (status) {
        return status < 500; // Принимаем 4xx статусы для анализа
      }
    });

    const duration = Date.now() - startTime;

    if (response.status === 200) {
      const responseText = response.data.content?.[0]?.text || 'No content';
      logSuccess(`✅ Model ${model} works! Response: "${responseText}" (${duration}ms)`);
      return { success: true, model, responseText, duration };
    } else {
      logError(`❌ Model ${model} failed with status ${response.status}`);
      logError(`Response: ${JSON.stringify(response.data, null, 2)}`);
      return { success: false, model, error: `HTTP ${response.status}`, response: response.data };
    }

  } catch (error) {
    let errorMessage = 'Unknown error';
    
    if (axios.isAxiosError(error)) {
      if (error.response) {
        errorMessage = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`;
      } else if (error.request) {
        errorMessage = `Network error: ${error.code || error.message}`;
      } else {
        errorMessage = `Request setup error: ${error.message}`;
      }
    } else {
      errorMessage = error.message;
    }

    logError(`❌ Model ${model} failed: ${errorMessage}`);
    return { success: false, model, error: errorMessage };
  }
}

async function testAllModels() {
  logInfo('=== TESTING ALL CLAUDE MODELS ===');
  const results = [];

  for (const model of TEST_MODELS) {
    const result = await testAllModels(model);
    results.push(result);
    
    // Небольшая пауза между запросами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

async function main() {
  console.log('🚀 Claude API Test Script for Staging Environment');
  console.log('================================================');
  
  printEnvironmentInfo();
  
  logInfo('Starting Claude API tests...');
  console.log('');
  
  const results = [];
  
  for (const model of TEST_MODELS) {
    const result = await testClaudeModel(model);
    results.push(result);
    
    // Пауза между тестами
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('');
  }
  
  // Сводка результатов
  console.log('=== TEST SUMMARY ===');
  const successfulModels = results.filter(r => r.success);
  const failedModels = results.filter(r => !r.success);
  
  if (successfulModels.length > 0) {
    logSuccess(`✅ Working models (${successfulModels.length}/${results.length}):`);
    successfulModels.forEach(r => {
      console.log(`   - ${r.model}: "${r.responseText}" (${r.duration}ms)`);
    });
  }
  
  if (failedModels.length > 0) {
    logError(`❌ Failed models (${failedModels.length}/${results.length}):`);
    failedModels.forEach(r => {
      console.log(`   - ${r.model}: ${r.error}`);
    });
  }
  
  console.log('');
  
  if (successfulModels.length === 0) {
    logError('🔥 ALL MODELS FAILED! Check API key, network, or geographic restrictions.');
    process.exit(1);
  } else if (failedModels.length === 0) {
    logSuccess('🎉 ALL MODELS WORKING! Claude API is fully functional.');
  } else {
    logInfo(`⚠️  PARTIAL SUCCESS: ${successfulModels.length}/${results.length} models working.`);
    logInfo('Recommendation: Use working models as fallback in your application.');
  }
}

// Запуск тестов
main().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});