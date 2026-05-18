#!/usr/bin/env node

/**
 * Финальный тест прокси с реальным файлом
 */

import http from 'http';

async function testProxyFinal() {
  // Используем файл, который мы знаем что существует
  const videoId = 'instagram_test_1755686860211.mp4';
  const proxyUrl = `http://localhost:5000/api/instagram-video-proxy/${videoId}`;
  
  console.log('🚀 ФИНАЛЬНЫЙ ТЕСТ ПРОКСИ');
  console.log('='.repeat(50));
  console.log(`📹 Тестируем: ${videoId}`);
  console.log(`🔗 Прокси URL: ${proxyUrl}`);
  
  return new Promise((resolve) => {
    const req = http.request(proxyUrl, { method: 'HEAD' }, (res) => {
      console.log('\n📊 РЕЗУЛЬТАТ:');
      console.log(`HTTP Status: ${res.statusCode}`);
      console.log(`Content-Type: ${res.headers['content-type'] || 'НЕ НАЙДЕН'}`);
      console.log(`Accept-Ranges: ${res.headers['accept-ranges'] || 'НЕ НАЙДЕН'}`);
      console.log(`Content-Length: ${res.headers['content-length'] || 'НЕ НАЙДЕН'}`);
      
      if (res.statusCode === 200 && res.headers['accept-ranges'] === 'bytes') {
        console.log('\n🎉 ПРОКСИ РАБОТАЕТ ИДЕАЛЬНО!');
        console.log('✅ Instagram может использовать этот URL');
        console.log(`📱 Рабочий URL: ${proxyUrl}`);
      } else if (res.statusCode === 404) {
        console.log('\n❓ ФАЙЛ НЕ НАЙДЕН - это нормально для тестового файла');
        console.log('💡 Прокси работает, но файл удален или в другой папке');
      } else {
        console.log('\n❌ ПРОКСИ НУЖДАЕТСЯ В НАСТРОЙКЕ');
      }
      
      resolve(res.statusCode === 200);
    });
    
    req.on('error', (error) => {
      console.error(`❌ Ошибка: ${error.message}`);
      resolve(false);
    });
    
    req.end();
  });
}

async function testDirectS3() {
  console.log('\n🔍 ТЕСТ ПРЯМОГО S3:');
  console.log('-'.repeat(30));
  
  // Тестируем прямой доступ к известному файлу
  const s3Url = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/test/instagram_test_1755686860211.mp4';
  
  return new Promise((resolve) => {
    const req = http.request(s3Url, { method: 'HEAD' }, (res) => {
      console.log(`S3 Status: ${res.statusCode}`);
      console.log(`S3 Content-Type: ${res.headers['content-type']}`);
      console.log(`S3 Accept-Ranges: ${res.headers['accept-ranges'] || 'НЕ НАЙДЕН'}`);
      
      if (res.headers['accept-ranges'] === 'bytes') {
        console.log('✅ S3 ПОДДЕРЖИВАЕТ Accept-Ranges: bytes');
        console.log('💡 Проблема не в S3, а в логике прокси');
      } else {
        console.log('❌ S3 не поддерживает Accept-Ranges');
      }
      
      resolve(res.statusCode === 200);
    });
    
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function main() {
  await testDirectS3();
  await testProxyFinal();
  
  console.log('\n🎯 ИТОГ:');
  console.log('Если S3 работает, а прокси нет - нужно исправить логику прокси');
  console.log('Если оба работают - Instagram может использовать прокси URL');
}

main().catch(console.error);