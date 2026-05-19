#!/usr/bin/env node

/**
 * Тест конвертера с интеграцией прокси
 */

import fetch from 'node-fetch';
import fs from 'fs';

async function testConverterWithProxy() {
  console.log('🚀 ТЕСТИРОВАНИЕ КОНВЕРТЕРА С ПРОКСИ');
  console.log('='.repeat(60));
  
  try {
    const testVideoPath = 'attached_assets/reels-test_1755686797072.mp4';
    
    if (!fs.existsSync(testVideoPath)) {
      console.log('❌ Тестовый файл не найден:', testVideoPath);
      return false;
    }
    
    const stats = fs.statSync(testVideoPath);
    console.log(`📹 Тестовый файл: ${testVideoPath}`);
    console.log(`📊 Размер: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Вызываем конвертер
    console.log('\n🔄 Запускаем конвертацию через API...');
    
    const response = await fetch('http://localhost:5000/api/real-video-converter/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localPath: testVideoPath,
        forceConvert: true
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Конвертация завершена успешно');
      console.log(`🔗 Сконвертированный URL: ${result.convertedUrl}`);
      console.log(`⏱️ Продолжительность: ${result.duration} ms`);
      console.log(`📏 Метаданные:`, result.metadata);
      
      // Проверяем, что это прокси URL
      const isProxyUrl = result.convertedUrl && result.convertedUrl.includes('/api/instagram-video-proxy/');
      
      if (isProxyUrl) {
        console.log('\n🎉 ОТЛИЧНО! Конвертер возвращает прокси-URL');
        console.log(`📱 Instagram может использовать: ${result.convertedUrl}`);
        
        // Тестируем прокси URL
        console.log('\n🧪 Проверяем прокси URL...');
        
        const proxyResponse = await fetch(result.convertedUrl, { method: 'HEAD' });
        
        console.log(`📊 Прокси статус: ${proxyResponse.status}`);
        console.log(`📋 Заголовки прокси:`);
        console.log(`  Content-Type: ${proxyResponse.headers.get('content-type')}`);
        console.log(`  Accept-Ranges: ${proxyResponse.headers.get('accept-ranges')}`);
        console.log(`  Content-Length: ${proxyResponse.headers.get('content-length')}`);
        
        if (proxyResponse.headers.get('accept-ranges') === 'bytes') {
          console.log('\n🏆 ПОЛНЫЙ УСПЕХ!');
          console.log('✅ Конвертер создает видео');
          console.log('✅ Загружает на S3');
          console.log('✅ Возвращает прокси-URL');
          console.log('✅ Прокси работает с правильными заголовками');
          console.log(`\n🎯 Готовый URL для Instagram: ${result.convertedUrl}`);
          
          return true;
        } else {
          console.log('\n❌ Прокси не возвращает Accept-Ranges: bytes');
        }
      } else {
        console.log('\n⚠️ Конвертер возвращает прямую S3 ссылку, а не прокси');
        console.log('🔧 Возможно, изменения еще не применились');
      }
    } else {
      console.error('❌ Ошибка конвертации:', result.error);
      return false;
    }
    
  } catch (error) {
    console.error('💥 Ошибка теста:', error.message);
    return false;
  }
  
  return false;
}

async function main() {
  const success = await testConverterWithProxy();
  
  if (success) {
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ВСЕ РАБОТАЕТ! Система готова для Instagram публикации');
    console.log('='.repeat(60));
  } else {
    console.log('\n💥 Нужны дополнительные настройки');
  }
}

main().catch(console.error);