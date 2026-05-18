/**
 * Тестовый скрипт для проверки отправки текста вместе с изображениями в Telegram
 * Запустите: node test-telegram-caption.js
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error('Ошибка: Необходимо указать TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env файле');
  process.exit(1);
}

// Функция для отправки нескольких изображений с текстом в подписи
async function sendImagesWithCaption(images, caption) {
  try {
    console.log(`Отправка ${images.length} изображений с подписью: "${caption}"`);
    
    const baseUrl = `https://api.telegram.org/bot${token}`;
    
    // Одно изображение отправляем с подписью через sendPhoto
    if (images.length === 1) {
      console.log(`Отправка одного изображения через sendPhoto`);
      
      const formData = new FormData();
      formData.append('chat_id', chatId);
      
      // Если изображение - это путь к файлу, загружаем содержимое
      if (fs.existsSync(images[0])) {
        formData.append('photo', fs.createReadStream(images[0]));
      } else {
        // В противном случае считаем, что это URL
        formData.append('photo', images[0]);
      }
      
      // Добавляем подпись и указываем режим парсинга HTML
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
      }
      
      const response = await axios.post(`${baseUrl}/sendPhoto`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });
      
      if (response.data && response.data.ok) {
        console.log(`Изображение с подписью успешно отправлено, message_id: ${response.data.result.message_id}`);
        return {
          success: true,
          messageId: response.data.result.message_id,
          chatId: chatId
        };
      } else {
        console.error('Ошибка при отправке изображения:', response.data);
        return { success: false, error: response.data };
      }
    }
    // Несколько изображений отправляем как медиа-группу с подписью на первом фото
    else {
      console.log(`Отправка ${images.length} изображений через sendMediaGroup`);
      
      // Создаем медиа-массив
      const media = images.map((img, index) => {
        const mediaItem = {
          type: 'photo',
          media: fs.existsSync(img) ? `attach://${index}` : img,
          // Подпись только на первом изображении
          ...(index === 0 && caption ? {
            caption,
            parse_mode: 'HTML'
          } : {})
        };
        return mediaItem;
      });
      
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('media', JSON.stringify(media));
      
      // Добавляем файлы, если это локальные изображения
      images.forEach((img, index) => {
        if (fs.existsSync(img)) {
          formData.append(`${index}`, fs.createReadStream(img));
        }
      });
      
      const response = await axios.post(`${baseUrl}/sendMediaGroup`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });
      
      if (response.data && response.data.ok) {
        console.log(`Группа изображений с подписью успешно отправлена, message_id первого сообщения: ${response.data.result[0].message_id}`);
        return {
          success: true,
          messageId: response.data.result[0].message_id,
          chatId: chatId
        };
      } else {
        console.error('Ошибка при отправке группы изображений:', response.data);
        return { success: false, error: response.data };
      }
    }
  } catch (error) {
    console.error('Ошибка при отправке изображений:', error.message);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('Запуск тестов для Telegram с отправкой короткого текста как подписи...');
  
  // Тест 1: Отправка одного изображения с коротким текстом
  const testOneImage = await sendImagesWithCaption(
    ['https://picsum.photos/1200/800'], // Случайное изображение
    'Тестовое сообщение для одного изображения'
  );
  
  // Тест 2: Отправка нескольких изображений с коротким текстом
  const testMultipleImages = await sendImagesWithCaption(
    ['https://picsum.photos/1200/800', 'https://picsum.photos/800/600'], // Случайные изображения
    'Тестовое сообщение для группы изображений'
  );
  
  console.log('\nРезультаты тестов:');
  console.log('Тест 1 (одно изображение с подписью):', testOneImage.success ? 'УСПЕШНО' : 'ОШИБКА');
  console.log('Тест 2 (несколько изображений с подписью):', testMultipleImages.success ? 'УСПЕШНО' : 'ОШИБКА');
}

// Запускаем тесты
runTests().catch(console.error);