/**
 * Тестовый скрипт для проверки отправки нескольких изображений во ВКонтакте
 */
import { config } from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';

config();

const VK_ACCESS_TOKEN = process.env.VK_ACCESS_TOKEN || "vk1.a.0jlmORGkgmds1qIB5btPIIuT1FZ8C_bkGpCcowI9Ml214neQFgVMiYEnePWq48txdx3D7oTtKbEvgnEifytkkyjv1FvooFsI0y_YYPX8Cw__525Tnqt_H7C9hEEdmsqHXExr4Q3DK7CL0quCvnhrhN368Ter9yFLe6buYgpnamBXwUx4yZnRJPdBVfnPmObtZRrXw7NaZJboCqAK8sXLEA";
const VK_GROUP_ID = process.env.VK_GROUP_ID || "club228626989";

// Функция для загрузки изображения из файловой системы
async function loadImageFromPath(imagePath) {
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
      fileContent,
      buffer: fileContent
    };
  } catch (error) {
    console.error('Ошибка при загрузке изображения:', error.message);
    return null;
  }
}

// Получение URL для загрузки фотографий на сервер ВКонтакте
async function getWallUploadServer(groupId, token) {
  try {
    console.log(`Получение URL для загрузки фото в группу ${groupId}`);
    
    // Извлекаем числовой ID группы из формата "clubXXXXX"
    let numericGroupId = groupId;
    if (groupId.startsWith('club')) {
      numericGroupId = groupId.replace('club', '');
    } else if (groupId.startsWith('-')) {
      numericGroupId = groupId.substring(1);
    }
    
    const response = await axios.get('https://api.vk.com/method/photos.getWallUploadServer', {
      params: {
        group_id: numericGroupId,
        v: '5.131',
        access_token: token
      }
    });
    
    if (response.data && response.data.response && response.data.response.upload_url) {
      console.log('Успешно получен URL для загрузки фото:', response.data.response.upload_url);
      return response.data.response.upload_url;
    } else {
      console.error('Ошибка при получении URL для загрузки фото:', response.data);
      return null;
    }
  } catch (error) {
    console.error('Исключение при получении URL для загрузки фото:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', error.response.data);
    }
    return null;
  }
}

// Загрузка фотографии на сервер ВКонтакте
async function uploadPhotoToVkServer(uploadUrl, imageFile) {
  try {
    console.log(`Загрузка изображения ${imageFile.fileName} на сервер ВКонтакте`);
    
    const formData = new FormData();
    formData.append('photo', imageFile.buffer, {
      filename: imageFile.fileName,
      contentType: 'image/jpeg'
    });
    
    const response = await axios.post(uploadUrl, formData, {
      headers: formData.getHeaders()
    });
    
    if (response.data && response.data.server && response.data.photo && response.data.hash) {
      console.log('Фото успешно загружено на сервер ВКонтакте');
      return response.data;
    } else {
      console.error('Ошибка при загрузке фото на сервер ВКонтакте:', response.data);
      return null;
    }
  } catch (error) {
    console.error('Исключение при загрузке фото на сервер ВКонтакте:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', error.response.data);
    }
    return null;
  }
}

// Сохранение загруженной фотографии в альбом ВКонтакте
async function saveWallPhoto(groupId, photoData, token) {
  try {
    console.log('Сохранение фото в альбом ВКонтакте');
    
    // Извлекаем числовой ID группы из формата "clubXXXXX"
    let numericGroupId = groupId;
    if (groupId.startsWith('club')) {
      numericGroupId = groupId.replace('club', '');
    } else if (groupId.startsWith('-')) {
      numericGroupId = groupId.substring(1);
    }
    
    const response = await axios.get('https://api.vk.com/method/photos.saveWallPhoto', {
      params: {
        group_id: numericGroupId,
        photo: photoData.photo,
        server: photoData.server,
        hash: photoData.hash,
        v: '5.131',
        access_token: token
      }
    });
    
    if (response.data && response.data.response && response.data.response.length > 0) {
      const savedPhoto = response.data.response[0];
      console.log(`Фото успешно сохранено с ID: ${savedPhoto.id}`);
      return savedPhoto;
    } else {
      console.error('Ошибка при сохранении фото в альбом ВКонтакте:', response.data);
      return null;
    }
  } catch (error) {
    console.error('Исключение при сохранении фото в альбом ВКонтакте:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', error.response.data);
    }
    return null;
  }
}

// Публикация поста с изображениями на стене группы
async function postToWall(groupId, message, photoAttachments, token) {
  try {
    console.log(`Публикация поста в группу ${groupId} с ${photoAttachments.length} изображениями`);
    
    // Извлекаем числовой ID группы из формата "clubXXXXX"
    let numericGroupId = groupId;
    if (groupId.startsWith('club')) {
      numericGroupId = groupId.replace('club', '');
    } else if (groupId.startsWith('-')) {
      numericGroupId = groupId.substring(1);
    }
    
    // Формируем строку вложений
    const attachments = photoAttachments
      .map(photo => `photo${photo.owner_id}_${photo.id}`)
      .join(',');
    
    console.log('Строка вложений:', attachments);
    
    const response = await axios.get('https://api.vk.com/method/wall.post', {
      params: {
        owner_id: `-${numericGroupId}`, // Минус перед ID для публикации от имени группы
        from_group: 1,
        message: message,
        attachments: attachments,
        v: '5.131',
        access_token: token
      }
    });
    
    if (response.data && response.data.response && response.data.response.post_id) {
      const postId = response.data.response.post_id;
      console.log(`Пост успешно опубликован с ID: ${postId}`);
      
      // Формируем URL на опубликованный пост
      const postUrl = `https://vk.com/wall-${numericGroupId}_${postId}`;
      
      return {
        success: true,
        postId: postId,
        postUrl: postUrl
      };
    } else {
      console.error('Ошибка при публикации поста:', response.data);
      return {
        success: false,
        error: 'Ошибка при публикации поста'
      };
    }
  } catch (error) {
    console.error('Исключение при публикации поста:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// Основная функция для тестирования отправки нескольких изображений в ВК
async function testMultiImagePostingToVk() {
  try {
    console.log('Начало тестирования отправки нескольких изображений в ВКонтакте');
    
    // Проверяем наличие токена и ID группы
    if (!VK_ACCESS_TOKEN || !VK_GROUP_ID) {
      throw new Error('Не указаны VK_ACCESS_TOKEN или VK_GROUP_ID в переменных окружения');
    }
    
    // Загружаем изображения из файловой системы
    const image1 = await loadImageFromPath('./uploads/temp/test-image-1.jpg');
    const image2 = await loadImageFromPath('./uploads/temp/test-image-2.jpg');
    
    if (!image1 || !image2) {
      throw new Error('Ошибка при загрузке изображений из файловой системы');
    }
    
    // Получаем URL для загрузки фотографий
    const uploadUrl = await getWallUploadServer(VK_GROUP_ID, VK_ACCESS_TOKEN);
    if (!uploadUrl) {
      throw new Error('Не удалось получить URL для загрузки фотографий');
    }
    
    // Загружаем каждое изображение на сервер ВКонтакте и сохраняем в альбом
    const uploadedPhoto1 = await uploadPhotoToVkServer(uploadUrl, image1);
    const uploadedPhoto2 = await uploadPhotoToVkServer(uploadUrl, image2);
    
    if (!uploadedPhoto1 || !uploadedPhoto2) {
      throw new Error('Ошибка при загрузке изображений на сервер ВКонтакте');
    }
    
    const savedPhoto1 = await saveWallPhoto(VK_GROUP_ID, uploadedPhoto1, VK_ACCESS_TOKEN);
    const savedPhoto2 = await saveWallPhoto(VK_GROUP_ID, uploadedPhoto2, VK_ACCESS_TOKEN);
    
    if (!savedPhoto1 || !savedPhoto2) {
      throw new Error('Ошибка при сохранении изображений в альбом ВКонтакте');
    }
    
    // Текст сообщения для поста
    const message = `Тестовая отправка нескольких изображений в ВКонтакте

Этот тест проверяет отправку нескольких изображений в ВКонтакте.

Функциональность включает:
• Отправку нескольких изображений в одном посте
• Корректное формирование URL для публикации
• Работу с API ВКонтакте версии 5.131

Текст НЕ поддерживает HTML-форматирование, как в Telegram.`;
    
    // Публикуем пост с изображениями
    const postResult = await postToWall(
      VK_GROUP_ID, 
      message, 
      [savedPhoto1, savedPhoto2], 
      VK_ACCESS_TOKEN
    );
    
    if (postResult.success) {
      console.log('=== РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ОТПРАВКИ В ВКОНТАКТЕ ===');
      console.log(`ID поста: ${postResult.postId}`);
      console.log(`URL поста: ${postResult.postUrl}`);
      
      return {
        success: true,
        postId: postResult.postId,
        postUrl: postResult.postUrl
      };
    } else {
      throw new Error(`Ошибка при публикации поста: ${postResult.error}`);
    }
  } catch (error) {
    console.error('Ошибка при тестировании отправки в ВКонтакте:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Запуск тестирования
testMultiImagePostingToVk()
  .then(result => {
    if (result.success) {
      console.log('Тест успешно завершен!');
      console.log(`Ссылка на пост: ${result.postUrl}`);
    } else {
      console.log('Тест завершился с ошибкой:', result.error);
    }
    
    // Удаляем временные файлы, если они были созданы
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