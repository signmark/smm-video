#!/usr/bin/env node

/**
 * Быстрый тест S3 заголовков для Instagram
 */

import https from 'https';
import http from 'http';

async function checkHeaders(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    const req = protocol.request(url, { method: 'HEAD' }, (res) => {
      console.log(`🔍 Проверяем: ${url}`);
      console.log(`📊 HTTP Status: ${res.statusCode}`);
      console.log(`📋 Заголовки:`);
      
      const headers = res.headers;
      
      // Ключевые заголовки для Instagram
      const contentType = headers['content-type'];
      const acceptRanges = headers['accept-ranges'];
      const contentLength = headers['content-length'];
      const cacheControl = headers['cache-control'];
      
      console.log(`  Content-Type: ${contentType || 'НЕ НАЙДЕН'}`);
      console.log(`  Accept-Ranges: ${acceptRanges || 'НЕ НАЙДЕН'}`);
      console.log(`  Content-Length: ${contentLength || 'НЕ НАЙДЕН'}`);
      console.log(`  Cache-Control: ${cacheControl || 'НЕ НАЙДЕН'}`);
      
      // Проверяем Instagram совместимость
      let issues = [];
      
      if (!contentType || !contentType.startsWith('video/')) {
        issues.push('❌ Content-Type должен быть video/mp4');
      }
      
      if (acceptRanges !== 'bytes') {
        issues.push('❌ Accept-Ranges должен быть "bytes" для Instagram');
      }
      
      if (issues.length > 0) {
        console.log('\n🚫 ПРОБЛЕМЫ:');
        issues.forEach(issue => console.log(`  ${issue}`));
      } else {
        console.log('\n✅ ВСЕ ЗАГОЛОВКИ КОРРЕКТНЫ ДЛЯ INSTAGRAM');
      }
      
      resolve({ 
        success: true, 
        headers, 
        issues, 
        isInstagramCompatible: issues.length === 0 
      });
    });
    
    req.on('error', (error) => {
      console.error(`❌ Ошибка запроса: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      console.error('❌ Таймаут запроса');
      resolve({ success: false, error: 'Timeout' });
    });
    
    req.end();
  });
}

async function main() {
  console.log('🚀 БЫСТРАЯ ПРОВЕРКА S3 ЗАГОЛОВКОВ');
  console.log('=' .repeat(50));
  
  // Список URL для проверки
  const testUrls = [
    'https://lbrspb.beget.tech/videos/test.mp4',
    'https://lbrspb.beget.tech/test.mp4',
    // Тестовое видео с других источников для сравнения
    'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4'
  ];
  
  for (const url of testUrls) {
    const result = await checkHeaders(url);
    console.log('-'.repeat(50));
    
    if (result.success && result.isInstagramCompatible) {
      console.log('🎉 ЭТОТ URL СОВМЕСТИМ С INSTAGRAM!');
    } else if (result.success) {
      console.log('⚠️  ЭТОТ URL ТРЕБУЕТ НАСТРОЙКИ');
    } else {
      console.log('💥 ОШИБКА ДОСТУПА К URL');
    }
    
    console.log('');
  }
  
  console.log('💡 РЕКОМЕНДАЦИИ:');
  console.log('1. Если Accept-Ranges отсутствует - обратитесь в поддержку Beget');
  console.log('2. Убедитесь, что видео загружаются с Content-Type: video/mp4');
  console.log('3. Проверьте публичный доступ к файлам в S3');
}

main().catch(console.error);