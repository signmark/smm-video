/**
 * Скрипт для красивого вывода результатов тестов в стиле pytest
 * Запуск: node pytest-style-output.js
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Получаем текущую директорию для использования в ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Цвета для вывода в консоль
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

/**
 * Выводит заголовок теста
 * @param {string} testFile Имя файла с тестами
 */
function printHeader(testFile) {
  const fileName = path.basename(testFile);
  console.log(`\n${colors.bold}${colors.blue}===== Запуск тестов: ${fileName} =====${colors.reset}\n`);
}

/**
 * Выводит результаты тестов
 * @param {Array} tests Массив тестов
 */
function printTestResults(tests) {
  tests.forEach(test => {
    const symbol = test.status === 'passed' 
      ? `${colors.green}✓${colors.reset}` 
      : `${colors.red}✗${colors.reset}`;
    
    const status = test.status === 'passed'
      ? `${colors.green}PASSED${colors.reset}`
      : `${colors.red}FAILED${colors.reset}`;
    
    console.log(`${symbol} ${test.fullName} - ${status}`);
    
    if (test.status === 'failed' && test.failureMessages && test.failureMessages.length > 0) {
      console.log(`${colors.red}  Ошибка: ${test.failureMessages[0].split('\n')[0]}${colors.reset}`);
    }
  });
}

/**
 * Выводит сводную информацию о результатах тестов
 * @param {Array} tests Массив тестов
 */
function printSummary(tests) {
  const total = tests.length;
  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = total - passed;
  
  console.log(`\n${colors.bold}${colors.blue}===== Сводка результатов =====${colors.reset}`);
  console.log(`${colors.bold}Всего тестов:${colors.reset} ${total}`);
  console.log(`${colors.bold}${colors.green}Пройдено:${colors.reset} ${passed}`);
  
  if (failed > 0) {
    console.log(`${colors.bold}${colors.red}Провалено:${colors.reset} ${failed}`);
  } else {
    console.log(`${colors.bold}${colors.green}Провалено:${colors.reset} ${failed}`);
  }
  
  const runtime = tests.reduce((sum, test) => sum + (test.duration || 0), 0) / 1000;
  console.log(`${colors.bold}Время выполнения:${colors.reset} ${runtime.toFixed(2)} сек.`);
  
  const statusSymbol = failed === 0 
    ? `${colors.green}✓${colors.reset}` 
    : `${colors.red}✗${colors.reset}`;
  
  console.log(`\n${statusSymbol} ${colors.bold}Статус:${colors.reset} ${failed === 0 
    ? `${colors.green}УСПЕШНО${colors.reset}` 
    : `${colors.red}НЕУДАЧНО${colors.reset}`}`);
}

/**
 * Основная функция для запуска и вывода результатов тестов
 */
function main() {
  try {
    console.log(`${colors.bold}${colors.blue}===== Запуск тестов SMM Менеджера =====${colors.reset}`);
    console.log(`${colors.cyan}Дата:${colors.reset} ${new Date().toLocaleString()}\n`);
    
    // Запускаем Jest и получаем результаты в формате JSON
    const jestCommand = 'npx jest --json';
    
    console.log(`${colors.yellow}Выполнение команды:${colors.reset} ${jestCommand}\n`);
    const result = execSync(jestCommand, { encoding: 'utf-8' });
    
    // Парсим результаты
    const { testResults } = JSON.parse(result);
    
    // Группируем тесты по файлам и выводим результаты
    const fileGroups = {};
    let allTests = [];
    
    testResults.forEach(fileResult => {
      const filePath = fileResult.name;
      
      if (fileResult.testResults && fileResult.testResults.length > 0) {
        printHeader(filePath);
        printTestResults(fileResult.testResults);
        
        // Добавляем тесты в общий список для сводки
        allTests = allTests.concat(fileResult.testResults);
      }
    });
    
    // Выводим общую сводку
    printSummary(allTests);
  } catch (error) {
    console.error(`\n${colors.red}${colors.bold}Ошибка выполнения тестов:${colors.reset}\n`);
    console.error(error.toString());
    process.exit(1);
  }
}

// Запускаем основную функцию
main();