/**
 * Скрипт для исправления строк formatTelegramUrl в social-publishing-with-imgur.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Получаем текущий путь
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Путь к файлу social-publishing-with-imgur.ts
const filePath = path.join(__dirname, './server/services/social-publishing-with-imgur.ts');

// Чтение содержимого файла
let content = fs.readFileSync(filePath, 'utf8');

// Найти и заменить все проблемные места
const problematicPattern = /postUrl: this\.formatTelegramUrl\(chatId, formattedChatId, lastMessageId \|\| ''\)/g;
const fixedPattern = 'postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : null';

const updatedContent = content.replace(problematicPattern, fixedPattern);

// Сохранить обновленное содержимое обратно в файл
fs.writeFileSync(filePath, updatedContent, 'utf8');

console.log('Файл успешно обновлен. Проблемные URL исправлены.');