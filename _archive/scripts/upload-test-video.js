#!/usr/bin/env node

/**
 * Загружает тестовое видео на S3 и тестирует прокси
 */

import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

async function uploadVideo() {
  try {
    console.log('📤 Загружаем видео на S3...');
    
    const videoPath = 'attached_assets/reels-test_1755686797072.mp4';
    
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Файл не найден: ${videoPath}`);
    }
    
    const stats = fs.statSync(videoPath);
    console.log(`📹 Размер файла: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Используем прямой API для загрузки
    const response = await fetch('http://localhost:5000/api/test/instagram-upload-and-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        videoPath: videoPath,
        testName: 'reels-proxy-test'
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Видео загружено на S3');
      console.log(`🔗 S3 URL: ${result.data.uploadUrl}`);
      console.log(`📁 S3 Key: ${result.data.uploadKey}`);
      
      // Получаем имя файла для прокси
      const fileName = result.data.uploadKey.split('/').pop();
      const proxyUrl = `http://localhost:5000/api/instagram-video-proxy/${fileName}`;
      
      console.log(`\n🚀 ПРОКСИ URL: ${proxyUrl}`);
      
      // Проверяем, что прокси работает
      console.log('\n🧪 Тестируем прокси...');
      
      const proxyResponse = await fetch(proxyUrl, { method: 'HEAD' });
      
      console.log(`📊 Прокси статус: ${proxyResponse.status}`);
      console.log(`📋 Заголовки:`);
      console.log(`  Content-Type: ${proxyResponse.headers.get('content-type')}`);
      console.log(`  Accept-Ranges: ${proxyResponse.headers.get('accept-ranges')}`);
      console.log(`  Content-Length: ${proxyResponse.headers.get('content-length')}`);
      
      if (proxyResponse.headers.get('accept-ranges') === 'bytes') {
        console.log('\n🎉 ПРОКСИ РАБОТАЕТ ИДЕАЛЬНО!');
        console.log('✅ Instagram может использовать этот URL');
        console.log(`\n🎯 Готовый URL для Instagram: ${proxyUrl}`);
        
        // Дополнительно тестируем Range запрос
        console.log('\n🔄 Тестируем Range запрос...');
        const rangeResponse = await fetch(proxyUrl, {
          headers: { 'Range': 'bytes=0-1023' }
        });
        
        console.log(`📊 Range статус: ${rangeResponse.status}`);
        if (rangeResponse.status === 206) {
          console.log('✅ Range запросы работают (HTTP 206)');
          console.log(`📋 Content-Range: ${rangeResponse.headers.get('content-range')}`);
        }
        
        return proxyUrl;
      } else {
        console.log('\n❌ Прокси не возвращает Accept-Ranges: bytes');
      }
    } else {
      console.error(`❌ Ошибка загрузки: ${result.error}`);
    }
  } catch (error) {
    console.error(`💥 Ошибка: ${error.message}`);
  }
  
  return null;
}

async function main() {
  console.log('🚀 ЗАГРУЗКА ВИДЕО И ТЕСТИРОВАНИЕ ПРОКСИ');
  console.log('='.repeat(60));
  
  const proxyUrl = await uploadVideo();
  
  if (proxyUrl) {
    console.log('\n' + '='.repeat(60));
    console.log('🏆 УСПЕХ! Прокси URL готов для Instagram:');
    console.log(`🔗 ${proxyUrl}`);
    console.log('='.repeat(60));
  } else {
    console.log('\n💥 Тестирование не удалось');
  }
}

main().catch(console.error);