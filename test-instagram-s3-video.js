#!/usr/bin/env node

/**
 * Скрипт для тестирования Instagram видео на S3
 * Проверяет, правильно ли настроено S3 хранилище для Instagram Graph API
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');

const API_BASE = 'http://localhost:5000';

// Тестовые URL видео (замените на реальные из вашего S3)
const TEST_VIDEOS = [
  // Добавьте сюда URL видео из вашего S3
  'https://lbrspb.beget.tech/videos/ig_stories_converted_example.mp4',
  // Можно добавить больше для тестирования
];

async function testVideoUrl(videoUrl) {
  console.log(`\n🔍 Тестируем видео: ${videoUrl}`);
  console.log('='.repeat(60));

  try {
    const response = await axios.post(`${API_BASE}/api/test/instagram-video`, {
      videoUrl: videoUrl
    });

    const { data } = response.data;
    
    console.log(`✅ Статус: ${data.isValid ? 'ВАЛИДНЫЙ' : 'НЕВАЛИДНЫЙ'}`);
    
    if (data.errors.length > 0) {
      console.log('\n❌ ОШИБКИ:');
      data.errors.forEach(error => {
        console.log(`  - ${error}`);
      });
    }
    
    if (data.warnings.length > 0) {
      console.log('\n⚠️ ПРЕДУПРЕЖДЕНИЯ:');
      data.warnings.forEach(warning => {
        console.log(`  - ${warning}`);
      });
    }
    
    console.log('\n📋 ДЕТАЛИ:');
    console.log(`  HTTP Status: ${data.details.statusCode}`);
    console.log(`  Content-Type: ${data.details.contentType}`);
    console.log(`  Accept-Ranges: ${data.details.acceptRanges ? 'bytes ✅' : 'не поддерживается ❌'}`);
    if (data.details.contentLength) {
      const sizeMB = (data.details.contentLength / (1024 * 1024)).toFixed(1);
      console.log(`  Размер файла: ${sizeMB} MB`);
    }

    return data.isValid;

  } catch (error) {
    console.error(`❌ Ошибка при тестировании: ${error.message}`);
    if (error.response) {
      console.error(`   Статус: ${error.response.status}`);
      console.error(`   Ответ: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function testS3Headers(fileKey) {
  console.log(`\n🔍 Проверяем заголовки S3 файла: ${fileKey}`);
  console.log('='.repeat(60));

  try {
    const response = await axios.get(`${API_BASE}/api/test/instagram-s3-headers/${fileKey}`);
    
    const { data } = response.data;
    
    console.log(`✅ Публичный URL: ${data.publicUrl}`);
    console.log(`✅ Статус: ${data.validation.isValid ? 'ВАЛИДНЫЙ' : 'НЕВАЛИДНЫЙ'}`);
    
    if (data.validation.errors.length > 0) {
      console.log('\n❌ ОШИБКИ:');
      data.validation.errors.forEach(error => {
        console.log(`  - ${error}`);
      });
    }
    
    console.log('\n📋 HTTP ЗАГОЛОВКИ:');
    Object.entries(data.validation.details.headers || {}).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    return data.validation.isValid;

  } catch (error) {
    console.error(`❌ Ошибка при проверке заголовков: ${error.message}`);
    return false;
  }
}

async function uploadAndTestVideo(videoPath) {
  console.log(`\n📤 Загружаем и тестируем видео: ${videoPath}`);
  console.log('='.repeat(60));

  if (!fs.existsSync(videoPath)) {
    console.error(`❌ Файл не найден: ${videoPath}`);
    return false;
  }

  try {
    const response = await axios.post(`${API_BASE}/api/test/instagram-upload-and-test`, {
      videoPath: videoPath
    });

    const { data } = response.data;
    
    console.log(`✅ Видео загружено: ${data.uploadUrl}`);
    console.log(`✅ S3 ключ: ${data.uploadKey}`);
    console.log(`✅ Статус: ${data.validation.isValid ? 'ВАЛИДНЫЙ' : 'НЕВАЛИДНЫЙ'}`);
    
    if (data.validation.errors.length > 0) {
      console.log('\n❌ ОШИБКИ:');
      data.validation.errors.forEach(error => {
        console.log(`  - ${error}`);
      });
    }

    return data.validation.isValid;

  } catch (error) {
    console.error(`❌ Ошибка при загрузке и тестировании: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 ТЕСТИРОВАНИЕ INSTAGRAM S3 ВИДЕО');
  console.log('='.repeat(60));
  
  let allValid = true;

  // 1. Тестируем существующие URL
  if (TEST_VIDEOS.length > 0) {
    console.log('\n📋 ТЕСТИРОВАНИЕ СУЩЕСТВУЮЩИХ URL');
    for (const videoUrl of TEST_VIDEOS) {
      const isValid = await testVideoUrl(videoUrl);
      if (!isValid) allValid = false;
    }
  }

  // 2. Тестируем заголовки конкретных файлов в S3
  const testKeys = [
    'videos/ig_stories_converted_example.mp4',
    'test/instagram_test.mp4'
    // Добавьте реальные ключи файлов из вашего S3
  ];

  console.log('\n📋 ТЕСТИРОВАНИЕ ЗАГОЛОВКОВ S3');
  for (const key of testKeys) {
    const isValid = await testS3Headers(key);
    if (!isValid) allValid = false;
  }

  // 3. Загрузка и тестирование нового файла (если есть тестовое видео)
  const testVideoPath = './test-video.mp4'; // Путь к тестовому видео
  if (fs.existsSync(testVideoPath)) {
    console.log('\n📋 ЗАГРУЗКА И ТЕСТИРОВАНИЕ НОВОГО ВИДЕО');
    const isValid = await uploadAndTestVideo(testVideoPath);
    if (!isValid) allValid = false;
  }

  // Результат
  console.log('\n' + '='.repeat(60));
  console.log(`🏁 ИТОГОВЫЙ РЕЗУЛЬТАТ: ${allValid ? '✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ' : '❌ ОБНАРУЖЕНЫ ПРОБЛЕМЫ'}`);
  
  if (!allValid) {
    console.log('\n💡 РЕКОМЕНДАЦИИ:');
    console.log('1. Обратитесь в поддержку Beget S3 для настройки заголовка Accept-Ranges: bytes');
    console.log('2. Проверьте настройки CORS для вашего S3 bucket');
    console.log('3. Убедитесь, что файлы загружаются с правильным Content-Type: video/mp4');
    console.log('4. Проверьте публичный доступ к файлам');
  }
}

// Запуск тестирования
main().catch(console.error);