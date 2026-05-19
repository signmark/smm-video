#!/usr/bin/env node

/**
 * Тест внешнего доступа к прокси
 */

import fetch from 'node-fetch';

async function testExternalProxy() {
  // Получаем домен Replit
  const replitDomain = process.env.REPLIT_DEV_DOMAIN || `${process.env.REPL_SLUG}-${process.env.REPL_OWNER}.replit.dev`;
  
  if (!replitDomain) {
    console.log('❌ Не удалось определить внешний домен Replit');
    return null;
  }
  
  console.log('🌐 ТЕСТИРОВАНИЕ ВНЕШНЕГО ПРОКСИ');
  console.log('='.repeat(50));
  console.log(`🔗 Replit домен: ${replitDomain}`);
  
  const videoId = 'instagram_test_1755687085314.mp4';
  const externalProxyUrl = `https://${replitDomain}/api/instagram-video-proxy/${videoId}`;
  
  console.log(`📹 Внешний прокси URL: ${externalProxyUrl}`);
  
  try {
    console.log('\n🧪 Тестируем внешний доступ...');
    
    const response = await fetch(externalProxyUrl, { method: 'HEAD' });
    
    console.log(`📊 HTTP Status: ${response.status}`);
    console.log(`📋 Заголовки:`);
    console.log(`  Content-Type: ${response.headers.get('content-type')}`);
    console.log(`  Accept-Ranges: ${response.headers.get('accept-ranges')}`);
    console.log(`  Content-Length: ${response.headers.get('content-length')}`);
    
    if (response.status === 200 && response.headers.get('accept-ranges') === 'bytes') {
      console.log('\n🎉 ВНЕШНИЙ ПРОКСИ РАБОТАЕТ!');
      console.log(`🌐 Готовый URL для Instagram: ${externalProxyUrl}`);
      
      // Тест Range запроса
      console.log('\n🔄 Тестируем Range запрос...');
      const rangeResponse = await fetch(externalProxyUrl, {
        headers: { 'Range': 'bytes=0-1023' }
      });
      
      if (rangeResponse.status === 206) {
        console.log('✅ Range запросы работают внешне (HTTP 206)');
        console.log(`📋 Content-Range: ${rangeResponse.headers.get('content-range')}`);
      }
      
      return externalProxyUrl;
    } else {
      console.log(`\n❌ Внешний прокси не работает: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`💥 Ошибка внешнего доступа: ${error.message}`);
    return null;
  }
}

async function main() {
  const externalUrl = await testExternalProxy();
  
  if (externalUrl) {
    console.log('\n' + '='.repeat(60));
    console.log('🏆 ГОТОВАЯ ВНЕШНЯЯ ССЫЛКА ДЛЯ INSTAGRAM:');
    console.log(`🔗 ${externalUrl}`);
    console.log('='.repeat(60));
  } else {
    console.log('\n💥 Внешний доступ не работает');
  }
}

main().catch(console.error);