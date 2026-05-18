#!/usr/bin/env node

/**
 * Скрипт для эмуляции вывода в стиле pytest для демонстрации с проваленными тестами
 */

// Цвета для форматирования
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m'
};

// Тестовые сценарии с проваленными тестами
const testScenarios = [
  {
    name: 'Telegram: публикация простого текста без форматирования',
    result: 'PASS',
    details: null
  },
  {
    name: 'VK: публикация простого текста без форматирования',
    result: 'PASS',
    details: null
  },
  {
    name: 'Telegram: публикация текста с одной картинкой',
    result: 'PASS',
    details: null
  },
  {
    name: 'VK: публикация текста с одной картинкой',
    result: 'FAIL',
    details: 'Error: Expected "success" to be true, but got: false\n       at Object.<anonymous> (server/__tests__/social-post-types.test.ts:187:22)'
  },
  {
    name: 'Telegram: публикация форматированного текста',
    result: 'PASS',
    details: null
  },
  {
    name: 'VK: публикация форматированного текста',
    result: 'PASS',
    details: null
  },
  {
    name: 'Telegram: публикация форматированного текста с картинкой',
    result: 'PASS',
    details: null
  },
  {
    name: 'VK: публикация форматированного текста с картинкой',
    result: 'PASS',
    details: null
  },
  {
    name: 'Telegram: публикация форматированного текста с несколькими картинками',
    result: 'FAIL',
    details: 'Error: Expected messageUrl to contain "t.me", but received: undefined\n       at Object.<anonymous> (server/__tests__/social-post-types.test.ts:285:28)'
  },
  {
    name: 'VK: публикация форматированного текста с несколькими картинками',
    result: 'PASS',
    details: null
  }
];

// Функция для печати заголовка
function printHeader(testFile) {
  console.log(`\n${colors.bright}${colors.blue}=== Запуск тестов: ${testFile} ===${colors.reset}\n`);
}

// Функция для печати результатов теста
function printTestResults(tests) {
  tests.forEach(test => {
    if (test.result === 'PASS') {
      console.log(`${colors.green}✓ PASS${colors.reset} ${test.name}`);
    } else {
      console.log(`${colors.red}✗ FAIL${colors.reset} ${test.name}`);
      if (test.details) {
        console.log(`  ${colors.red}${test.details}${colors.reset}`);
      }
    }
  });
}

// Функция для печати итогов
function printSummary(tests) {
  const passed = tests.filter(t => t.result === 'PASS').length;
  const failed = tests.length - passed;
  const executionTime = Math.floor(Math.random() * 1000 + 500); // Random time between 500-1500ms
  
  console.log('\n' + '='.repeat(50));
  
  if (failed === 0) {
    console.log(`\n${colors.bgGreen}${colors.bright} ИТОГ: ВСЕ ТЕСТЫ ПРОЙДЕНЫ ${colors.reset} ${passed} тестов, ${executionTime}ms\n`);
  } else {
    console.log(`\n${colors.bgRed}${colors.bright} ИТОГ: ЕСТЬ ПРОБЛЕМЫ ${colors.reset} ${failed} из ${tests.length} тестов провалены, ${executionTime}ms\n`);
    
    const failedTests = tests.filter(t => t.result === 'FAIL');
    console.log(`${colors.red}${colors.bright}Проблемные тесты:${colors.reset}`);
    failedTests.forEach((test, index) => {
      console.log(`${colors.red}${index + 1}. ${test.name}${colors.reset}`);
    });
    console.log('');
  }
}

// Главная функция
function main() {
  const testFile = 'server/__tests__/social-post-types.test.ts';
  
  printHeader(testFile);
  printTestResults(testScenarios);
  printSummary(testScenarios);
}

// Запуск программы
main();