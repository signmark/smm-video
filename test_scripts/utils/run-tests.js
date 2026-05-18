/**
 * Скрипт для запуска тестов
 * Для запуска используйте команду: node run-tests.js
 */

import { spawn, execSync } from 'child_process';
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
 * Проверяет существование файла
 * @param {string} filePath Путь к файлу
 * @returns {boolean} Существует файл или нет
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
}

/**
 * Запускает тесты с помощью Jest
 * @param {string[]} testFiles Файлы с тестами или директории
 * @returns {boolean} Успешны ли тесты
 */
function runTests(testFiles) {
  return new Promise((resolve) => {
    // По умолчанию запускаем все тесты, если не указаны конкретные файлы
    const args = testFiles.length ? testFiles : [];
    args.push('--verbose');
    
    console.log(`${colors.yellow}Запуск тестов:${colors.reset} npx jest ${args.join(' ')}\n`);
    
    const jestProcess = spawn('npx', ['jest', ...args], {
      stdio: 'inherit',
      shell: true
    });
    
    jestProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`\n${colors.green}${colors.bold}✓ Тесты успешно пройдены!${colors.reset}`);
        resolve(true);
      } else {
        console.log(`\n${colors.red}${colors.bold}✗ Ошибка при выполнении тестов!${colors.reset}`);
        resolve(false);
      }
    });
  });
}

/**
 * Главная функция
 */
async function main() {
  console.log(`\n${colors.blue}${colors.bold}===== Запуск тестов для SMM Manager =====${colors.reset}`);
  console.log(`${colors.cyan}Дата:${colors.reset} ${new Date().toLocaleString()}\n`);
  
  // Получаем аргументы командной строки (пропускаем node и имя скрипта)
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`${colors.bold}Использование:${colors.reset}`);
    console.log(`  node run-tests.js [опции] [путь к тестам]`);
    console.log(`\n${colors.bold}Опции:${colors.reset}`);
    console.log(`  --help, -h     Показать эту справку`);
    console.log(`  --pretty       Использовать вывод в стиле pytest`);
    console.log(`  --watch        Запустить тесты в режиме наблюдения`);
    console.log(`\n${colors.bold}Примеры:${colors.reset}`);
    console.log(`  node run-tests.js                                    # запустить все тесты`);
    console.log(`  node run-tests.js --pretty                           # запустить с красивым выводом`);
    console.log(`  node run-tests.js server/__tests__/telegram-service.test.ts  # запустить конкретный тест`);
    return;
  }
  
  // Проверка аргументов
  const usePrettyOutput = args.includes('--pretty');
  const watchMode = args.includes('--watch');
  
  // Фильтруем аргументы, чтобы получить только пути к тестам
  const testPaths = args.filter(arg => !arg.startsWith('--'));
  
  // Проверяем, существуют ли указанные файлы
  for (const testPath of testPaths) {
    if (!fileExists(testPath)) {
      console.log(`${colors.red}Ошибка: Файл или директория не найдены: ${testPath}${colors.reset}`);
      process.exit(1);
    }
  }
  
  // Для красивого вывода используем наш скрипт
  if (usePrettyOutput) {
    const prettyScript = path.join(__dirname, 'pytest-style-output.js');
    if (fileExists(prettyScript)) {
      try {
        execSync(`node ${prettyScript}`, { stdio: 'inherit' });
      } catch (error) {
        process.exit(1);
      }
    } else {
      console.log(`${colors.red}Ошибка: Не найден скрипт для красивого вывода: ${prettyScript}${colors.reset}`);
      process.exit(1);
    }
    return;
  }
  
  // Для обычного запуска тестов
  const args2 = [...testPaths];
  if (watchMode) {
    args2.push('--watch');
  }
  
  await runTests(args2);
}

// Запускаем основную функцию
main().catch(error => {
  console.error(`${colors.red}${colors.bold}Ошибка при выполнении:${colors.reset}`, error);
  process.exit(1);
});