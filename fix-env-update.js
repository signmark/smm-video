/**
 * Скрипт для принудительного обновления переменной GOOGLE_SERVICE_ACCOUNT_KEY
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Читаем правильный Service Account из файла
const serviceAccountPath = path.join(__dirname, 'attached_assets', 'laboratory-449308-e59e916c28da.json');
const serviceAccountData = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

console.log('Обновляем GOOGLE_SERVICE_ACCOUNT_KEY в .env...');
console.log('Project ID:', serviceAccountData.project_id);

// Принудительно обновляем переменную окружения
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify(serviceAccountData);

// Читаем .env файл
const envPath = path.join(__dirname, '.env');
let envContent = fs.readFileSync(envPath, 'utf8');

// Обновляем или добавляем GOOGLE_SERVICE_ACCOUNT_KEY
const newKey = `GOOGLE_SERVICE_ACCOUNT_KEY=${JSON.stringify(serviceAccountData)}`;

if (envContent.includes('GOOGLE_SERVICE_ACCOUNT_KEY=')) {
  // Заменяем существующий ключ
  envContent = envContent.replace(/GOOGLE_SERVICE_ACCOUNT_KEY=.*$/m, newKey);
} else {
  // Добавляем новый ключ
  envContent += '\n' + newKey + '\n';
}

// Записываем обновленный .env файл
fs.writeFileSync(envPath, envContent);

console.log('✅ .env файл обновлен');

// Проверяем обновленную переменную
const updatedData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
console.log('✅ Проверка: Project ID =', updatedData.project_id);
console.log('✅ Client email =', updatedData.client_email);

console.log('Перезапустите сервер для применения изменений');