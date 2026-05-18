#!/usr/bin/env node

/**
 * Скрипт для запуска тестов с красивым выводом результатов в стиле pytest
 * Запуск: node test-runner.js [путь к тестам]
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Цвета для форматирования вывода
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m'
};

// Получаем аргументы командной строки
const testPath = process.argv[2] || 'server/__tests__/social-post-types.test.ts';

// Функция для форматирования времени выполнения
function formatTime(ms) {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

// Запускаем тесты
console.log(`\n${colors.bright}${colors.blue}=== Запуск тестов: ${testPath} ===${colors.reset}\n`);

const startTime = Date.now();

// Запускаем Jest с verbose режимом
const jestProcess = spawn('npx', ['jest', testPath, '--verbose', '--detectOpenHandles'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: 'true' }
});

// Обработка вывода
let buffer = '';
let failedTests = [];
let passedTests = [];
let currentTest = null;

jestProcess.stdout.on('data', (data) => {
  buffer += data.toString();
  processBuffer();
});

jestProcess.stderr.on('data', (data) => {
  console.error(`${colors.red}${data.toString()}${colors.reset}`);
});

function processBuffer() {
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Сохраняем последнюю строку, которая может быть неполной

  for (const line of lines) {
    // Поиск начала теста
    const testMatch = line.match(/^(\s*)(?:PASS|FAIL)(.+)$/);
    if (testMatch) {
      const status = line.includes('PASS') ? 'PASS' : 'FAIL';
      const testName = testMatch[2].trim();
      
      if (status === 'PASS') {
        passedTests.push(testName);
        console.log(`${colors.green}✓ PASS${colors.reset} ${testName}`);
      } else {
        failedTests.push(testName);
        console.log(`${colors.red}✗ FAIL${colors.reset} ${testName}`);
      }
      continue;
    }

    // Обработка сообщений об ошибках
    if (line.includes('Error:') || line.includes('expected') || line.includes('received')) {
      console.log(`  ${colors.red}${line}${colors.reset}`);
      continue;
    }

    // Пропускаем технические строки Jest
    if (line.includes('console.log') || 
        line.includes('console.warn') || 
        line.includes('console.error')) {
      continue;
    }

    // Вывод обычной строки, если она не пустая
    if (line.trim() && 
        !line.includes('Ran all test suites') && 
        !line.includes('Test Suites:') &&
        !line.includes('Tests:') &&
        !line.includes('Snapshots:') &&
        !line.includes('Time:')) {
      console.log(`  ${line}`);
    }
  }
}

jestProcess.on('close', (code) => {
  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log('\n' + '='.repeat(50));
  
  // Суммарный отчет
  if (code === 0) {
    console.log(`\n${colors.bgGreen}${colors.bright} ИТОГ: ВСЕ ТЕСТЫ ПРОЙДЕНЫ ${colors.reset} ${passedTests.length} тестов, ${formatTime(duration)}\n`);
  } else {
    console.log(`\n${colors.bgRed}${colors.bright} ИТОГ: ЕСТЬ ПРОБЛЕМЫ ${colors.reset} ${failedTests.length} из ${passedTests.length + failedTests.length} тестов провалены, ${formatTime(duration)}\n`);
    
    if (failedTests.length > 0) {
      console.log(`${colors.red}${colors.bright}Проблемные тесты:${colors.reset}`);
      failedTests.forEach((test, index) => {
        console.log(`${colors.red}${index + 1}. ${test}${colors.reset}`);
      });
      console.log('');
    }
  }

  process.exit(code);
});