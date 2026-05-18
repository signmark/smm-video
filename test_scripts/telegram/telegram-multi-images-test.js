/**
 * Тестовый скрипт для проверки отправки нескольких изображений в Telegram
 * с поддержкой HTML форматирования в подписи
 */
import { config } from 'dotenv';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Загрузка изображения
async function uploadImage(imagePath) {
  try {
    // Проверяем существование файла
    if (!fs.existsSync(imagePath)) {
      console.error(`Ошибка: Файл ${imagePath} не найден`);
      return null;
    }
    
    const fileContent = fs.readFileSync(imagePath);
    const fileName = path.basename(imagePath);
    
    console.log(`Изображение ${fileName} успешно загружено из файловой системы`);
    return {
      fileName,
      fileContent
    };
  } catch (error) {
    console.error('Ошибка при загрузке изображения:', error.message);
    return null;
  }
}

// Отправка нескольких изображений в Telegram
async function sendImagesToTelegram(imageFiles, caption) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error('Ошибка: не указаны TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID в .env файле');
      return null;
    }
    
    console.log(`Отправка ${imageFiles.length} изображений в чат: ${TELEGRAM_CHAT_ID}`);
    
    // Если нет изображений, отправляем только текст
    if (imageFiles.length === 0) {
      console.log('Нет изображений для отправки, отправляем только текст');
      const textUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const textResponse = await axios.post(textUrl, {
        chat_id: TELEGRAM_CHAT_ID,
        text: caption,
        parse_mode: 'HTML'
      });
      
      if (textResponse.status === 200 && textResponse.data && textResponse.data.ok) {
        return {
          success: true,
          messageId: textResponse.data.result.message_id,
          type: 'text'
        };
      } else {
        return { success: false, error: 'Ошибка отправки текста' };
      }
    }
    
    // Если одно изображение, отправляем его с подписью
    if (imageFiles.length === 1) {
      console.log('Отправка одного изображения с подписью');
      
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', imageFiles[0].fileContent, { filename: imageFiles[0].fileName });
      
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
      }
      
      const photoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
      const config = { headers: formData.getHeaders() };
      
      const photoResponse = await axios.post(photoUrl, formData, config);
      
      if (photoResponse.status === 200 && photoResponse.data && photoResponse.data.ok) {
        return {
          success: true,
          messageId: photoResponse.data.result.message_id,
          type: 'photo'
        };
      } else {
        return { success: false, error: 'Ошибка отправки фото' };
      }
    }
    
    // Если несколько изображений, отправляем их как медиагруппу
    console.log('Отправка группы изображений');
    
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    
    // Создаем массив объектов media для отправки
    const media = [];
    
    // Добавляем каждое изображение в FormData и массив media
    imageFiles.forEach((file, index) => {
      const mediaName = `photo${index}`;
      formData.append(mediaName, file.fileContent, { filename: file.fileName });
      
      // Добавляем описание только к первому изображению
      const mediaObj = {
        type: 'photo',
        media: `attach://${mediaName}`
      };
      
      if (index === 0 && caption) {
        mediaObj.caption = caption;
        mediaObj.parse_mode = 'HTML';
      }
      
      media.push(mediaObj);
    });
    
    formData.append('media', JSON.stringify(media));
    
    const mediaGroupUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`;
    const config = { headers: formData.getHeaders() };
    
    const mediaGroupResponse = await axios.post(mediaGroupUrl, formData, config);
    
    if (mediaGroupResponse.status === 200 && mediaGroupResponse.data && mediaGroupResponse.data.ok) {
      // У медиагруппы будет массив сообщений, берем ID первого
      const messageId = mediaGroupResponse.data.result[0].message_id;
      return {
        success: true,
        messageId: messageId,
        type: 'media_group'
      };
    } else {
      return { success: false, error: 'Ошибка отправки медиагруппы' };
    }
  } catch (error) {
    console.error('Исключение при отправке изображений:', error.message);
    return { success: false, error: error.message };
  }
}

// Получение URL сообщения
async function generatePostUrl(chatId, messageId) {
  try {
    // Получаем информацию о чате для определения username
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat`;
    const response = await axios.post(url, { chat_id: chatId });
    
    if (response.status === 200 && response.data && response.data.ok) {
      const chatInfo = response.data.result;
      const chatUsername = chatInfo.username;
      
      console.log('Полученная информация о чате:', JSON.stringify(chatInfo, null, 2));
      
      // Если известен username, формат: https://t.me/username/messageId
      if (chatUsername) {
        return `https://t.me/${chatUsername}/${messageId}`;
      }
      
      // Иначе для каналов/групп с числовым ID: формат: https://t.me/c/chatId/messageId
      if (chatId.startsWith('-100')) {
        const cleanId = chatId.substring(4);
        return `https://t.me/c/${cleanId}/${messageId}`;
      }
      
      // Для других чатов
      return `https://t.me/c/${chatId}/${messageId}`;
    } else {
      console.error('Ошибка при получении информации о чате:', response.data);
      
      // Формируем URL без username как запасной вариант
      if (chatId.startsWith('-100')) {
        const cleanId = chatId.substring(4);
        return `https://t.me/c/${cleanId}/${messageId}`;
      }
      return `https://t.me/c/${chatId}/${messageId}`;
    }
  } catch (error) {
    console.error('Исключение при генерации URL:', error.message);
    
    // Формируем URL без username как запасной вариант
    if (chatId.startsWith('-100')) {
      const cleanId = chatId.substring(4);
      return `https://t.me/c/${cleanId}/${messageId}`;
    }
    return `https://t.me/c/${chatId}/${messageId}`;
  }
}

// Основная функция для тестирования
async function testMultiImageSending() {
  try {
    console.log('Начало тестирования отправки нескольких изображений в Telegram');
    
    // Загружаем тестовые изображения
    const image1 = await uploadImage('./uploads/temp/test-image-1.jpg');
    const image2 = await uploadImage('./uploads/temp/test-image-2.jpg');
    
    // Если изображения не найдены, создаем тестовые файлы
    if (!image1 || !image2) {
      console.log('Создаем тестовые изображения...');
      
      // Создаем директорию, если она не существует
      const tempDir = './uploads/temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Создаем простые изображения с разными цветами
      // Это просто пример, на практике нужно использовать реальные изображения
      const testImage1 = fs.readFileSync('./attached_assets/image_1744033043683.png');
      const testImage2 = fs.readFileSync('./attached_assets/image_1744033645612.png');
      
      fs.writeFileSync('./uploads/temp/test-image-1.jpg', testImage1);
      fs.writeFileSync('./uploads/temp/test-image-2.jpg', testImage2);
      
      console.log('Тестовые изображения созданы');
      
      // Загружаем созданные изображения
      const image1 = await uploadImage('./uploads/temp/test-image-1.jpg');
      const image2 = await uploadImage('./uploads/temp/test-image-2.jpg');
      
      if (!image1 || !image2) {
        throw new Error('Не удалось создать тестовые изображения');
      }
    }
    
    // Текст с HTML-форматированием для подписи
    const caption = `<b>Тестовая отправка нескольких изображений</b>

<i>Этот тест проверяет отправку нескольких изображений в Telegram с HTML-форматированным текстом.</i>

Функциональность включает:
• Отправку <b>нескольких изображений</b> в одном сообщении
• Поддержку <i>HTML-форматирования</i> в подписи
• Корректное формирование <u>URL-адреса</u> для публикации

<a href="https://t.me/ya_delayu_moschno">Подпишитесь на канал</a>`;
    
    // Отправляем изображения с подписью
    const result = await sendImagesToTelegram([image1, image2], caption);
    
    if (result.success) {
      console.log(`Изображения успешно отправлены, тип: ${result.type}, ID сообщения: ${result.messageId}`);
      
      // Получаем URL сообщения
      const messageUrl = await generatePostUrl(TELEGRAM_CHAT_ID, result.messageId);
      
      console.log('=== РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ОТПРАВКИ НЕСКОЛЬКИХ ИЗОБРАЖЕНИЙ ===');
      console.log(`ID сообщения: ${result.messageId}`);
      console.log(`URL сообщения: ${messageUrl}`);
      console.log(`Тип сообщения: ${result.type}`);
      
      return {
        success: true,
        messageId: result.messageId,
        messageUrl: messageUrl,
        type: result.type
      };
    } else {
      console.error('Ошибка при отправке изображений:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('Исключение при тестировании отправки изображений:', error.message);
    return { success: false, error: error.message };
  }
}

// Запуск тестирования
testMultiImageSending()
  .then(result => {
    if (result.success) {
      console.log('Тест успешно завершен!');
      console.log(`Ссылка на сообщение: ${result.messageUrl}`);
    } else {
      console.log('Тест завершился с ошибкой:', result.error);
    }
    
    // Удаляем временные файлы если они были созданы
    try {
      if (fs.existsSync('./uploads/temp/test-image-1.jpg')) {
        fs.unlinkSync('./uploads/temp/test-image-1.jpg');
      }
      if (fs.existsSync('./uploads/temp/test-image-2.jpg')) {
        fs.unlinkSync('./uploads/temp/test-image-2.jpg');
      }
      console.log('Временные файлы удалены');
    } catch (e) {
      console.error('Ошибка при удалении временных файлов:', e.message);
    }
  })
  .catch(error => {
    console.error('Критическая ошибка при выполнении теста:', error.message);
  });