#!/usr/bin/env node

/**
 * Тест прокси-сервера для Instagram видео
 */

import http from 'http';

const API_BASE = 'http://localhost:5000';

async function testProxyHeaders(videoId) {
  return new Promise((resolve) => {
    const url = `${API_BASE}/api/instagram-video-proxy/${videoId}`;
    console.log(`🔍 Тестируем прокси: ${url}`);
    
    const req = http.request(url, { method: 'HEAD' }, (res) => {
      console.log(`📊 HTTP Status: ${res.statusCode}`);
      console.log(`📋 Заголовки прокси:`);
      
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
      } else {
        console.log('✅ Content-Type корректен');
      }
      
      if (acceptRanges !== 'bytes') {
        issues.push('❌ Accept-Ranges должен быть "bytes"');
      } else {
        console.log('✅ Accept-Ranges: bytes найден (ВАЖНО для Instagram)');
      }
      
      if (issues.length > 0) {
        console.log('\n🚫 ПРОБЛЕМЫ:');
        issues.forEach(issue => console.log(`  ${issue}`));
      } else {
        console.log('\n🎉 ПРОКСИ ПОЛНОСТЬЮ СОВМЕСТИМ С INSTAGRAM!');
      }
      
      resolve({ 
        success: res.statusCode === 200 || res.statusCode === 404, 
        headers, 
        issues, 
        isInstagramCompatible: issues.length === 0 && res.statusCode === 200
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

async function testRangeRequest(videoId) {
  return new Promise((resolve) => {
    const url = `${API_BASE}/api/instagram-video-proxy/${videoId}`;
    console.log(`\n🔍 Тестируем Range запрос: ${url}`);
    
    const options = {
      method: 'GET',
      headers: {
        'Range': 'bytes=0-1023'  // Первые 1KB
      }
    };
    
    const req = http.request(url, options, (res) => {
      console.log(`📊 HTTP Status: ${res.statusCode}`);
      
      if (res.statusCode === 206) {
        console.log('✅ Partial Content (206) поддерживается');
        console.log(`📋 Content-Range: ${res.headers['content-range'] || 'НЕ НАЙДЕН'}`);
        console.log('🎉 RANGE ЗАПРОСЫ РАБОТАЮТ (критично для Instagram)');
      } else {
        console.log('❌ Partial Content (206) не поддерживается');
        console.log(`   Получен статус: ${res.statusCode}`);
      }
      
      resolve({ 
        success: res.statusCode === 206,
        statusCode: res.statusCode,
        contentRange: res.headers['content-range']
      });
    });
    
    req.on('error', (error) => {
      console.error(`❌ Ошибка Range запроса: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
    
    req.end();
  });
}

async function main() {
  console.log('🚀 ТЕСТИРОВАНИЕ INSTAGRAM VIDEO PROXY');
  console.log('=' .repeat(50));
  
  const testVideoIds = [
    'test.mp4',
    'example.mp4',
    'ig_stories_converted_123.mp4'
  ];
  
  for (const videoId of testVideoIds) {
    console.log(`\n📹 Тестируем видео ID: ${videoId}`);
    console.log('-'.repeat(40));
    
    // Тест 1: HEAD запрос для проверки заголовков
    const headResult = await testProxyHeaders(videoId);
    
    // Тест 2: Range запрос (только если HEAD прошел успешно)
    if (headResult.success && headResult.isInstagramCompatible) {
      await testRangeRequest(videoId);
    }
    
    console.log('');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📝 ИТОГ: Если видишь "✅ Accept-Ranges: bytes" и "✅ Partial Content (206)"');
  console.log('то прокси работает правильно и Instagram должен принимать видео!');
}

main().catch(console.error);