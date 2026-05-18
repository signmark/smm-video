/**
 * Тестовый скрипт для проверки отправки текста вместе с изображениями в Telegram
 * Запустите: node telegram-caption-test.js
 */
import { config } from 'dotenv';
import axios from 'axios';

config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error('Ошибка: Необходимо указать TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env файле');
  process.exit(1);
}

// Функция для отправки одного изображения с текстом в подписи
async function sendImageWithCaption() {
  try {
    console.log('Отправка одного изображения с подписью');
    
    const baseUrl = `https://api.telegram.org/bot${token}`;
    
    // Используем случайное изображение из сервиса picsum.photos
    const imageUrl = 'https://picsum.photos/1200/800';
    const caption = 'Тестовое сообщение для проверки отправки короткого текста как подписи к изображению';
    
    // Создаем тело запроса
    const requestBody = {
      chat_id: chatId,
      photo: imageUrl,
      caption: caption,
      parse_mode: 'HTML'
    };
    
    // Отправляем запрос
    const response = await axios.post(`${baseUrl}/sendPhoto`, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    
    if (response.data && response.data.ok) {
      console.log(`Изображение с подписью успешно отправлено!`);
      console.log(`Message ID: ${response.data.result.message_id}`);
      return { success: true };
    } else {
      console.error('Ошибка при отправке изображения:', response.data);
      return { success: false, error: response.data };
    }
  } catch (error) {
    console.error('Ошибка при отправке изображения:', error.message);
    return { success: false, error: error.message };
  }
}

// Функция для отправки нескольких изображений с текстом в подписи
async function sendImagesGroupWithCaption() {
  try {
    console.log('Отправка группы изображений с подписью');
    
    const baseUrl = `https://api.telegram.org/bot${token}`;
    
    // Используем случайные изображения из сервиса picsum.photos
    const images = [
      'https://picsum.photos/1200/800',
      'https://picsum.photos/800/600'
    ];
    
    const caption = 'Тестовое сообщение для проверки отправки короткого текста как подписи к группе изображений';
    
    // Создаем медиа-массив (подпись прикрепляется только к первому изображению)
    const media = images.map((img, index) => ({
      type: 'photo',
      media: img,
      ...(index === 0 ? { caption, parse_mode: 'HTML' } : {})
    }));
    
    // Создаем тело запроса
    const requestBody = {
      chat_id: chatId,
      media: media
    };
    
    // Отправляем запрос
    const response = await axios.post(`${baseUrl}/sendMediaGroup`, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    
    if (response.data && response.data.ok) {
      console.log(`Группа изображений с подписью успешно отправлена!`);
      console.log(`Message ID первого сообщения: ${response.data.result[0].message_id}`);
      return { success: true };
    } else {
      console.error('Ошибка при отправке группы изображений:', response.data);
      return { success: false, error: response.data };
    }
  } catch (error) {
    console.error('Ошибка при отправке группы изображений:', error.message);
    return { success: false, error: error.message };
  }
}

// Запускаем тесты
async function runTests() {
  console.log('=== ТЕСТ ПОДПИСИ К ИЗОБРАЖЕНИЯМ В TELEGRAM ===');
  
  // Тест 1: Отправка одного изображения с подписью
  console.log('\n=== ТЕСТ 1: Одно изображение с подписью ===');
  const test1Result = await sendImageWithCaption();
  
  // Тест 2: Отправка группы изображений с подписью
  console.log('\n=== ТЕСТ 2: Группа изображений с подписью ===');
  const test2Result = await sendImagesGroupWithCaption();
  
  console.log('\n=== РЕЗУЛЬТАТЫ ТЕСТОВ ===');
  console.log(`Тест 1 (одно изображение с подписью): ${test1Result.success ? 'УСПЕШНО' : 'ОШИБКА'}`);
  console.log(`Тест 2 (группа изображений с подписью): ${test2Result.success ? 'УСПЕШНО' : 'ОШИБКА'}`);
}

// Запускаем тесты
runTests().catch(console.error);