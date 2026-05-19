#!/usr/bin/env node

const axios = require('axios');
require('dotenv').config();

async function removeDuplicateSources() {
  console.log('🔧 Начинаем удаление дубликатов источников...');

  // Получаем токен администратора из переменных окружения
  const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
  const directusUrl = process.env.DIRECTUS_URL;
  
  if (!adminToken) {
    console.error('❌ Токен администратора Directus не найден в .env');
    process.exit(1);
  }
  
  if (!directusUrl) {
    console.error('❌ URL Directus не найден в .env');
    process.exit(1);
  }

  try {
    // Получаем все источники
    console.log('📡 Получаем все источники из Directus...');
    const sourcesResponse = await axios.get(
      `${directusUrl}/items/campaign_content_sources`,
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const allSources = sourcesResponse.data.data;
    console.log(`📊 Найдено всего источников: ${allSources.length}`);

    // Группируем источники по URL для поиска дубликатов
    const sourcesByUrl = new Map();
    for (const source of allSources) {
      if (!sourcesByUrl.has(source.url)) {
        sourcesByUrl.set(source.url, []);
      }
      sourcesByUrl.get(source.url).push(source);
    }

    // Находим дубликаты
    const duplicates = [];
    const uniqueSources = [];
    
    for (const [url, sources] of sourcesByUrl) {
      if (sources.length > 1) {
        // Оставляем первый источник (самый старый по дате), остальные - дубликаты
        const [first, ...duplicateList] = sources.sort((a, b) => 
          new Date(a.date_created || a.created_at) - new Date(b.date_created || b.created_at)
        );
        uniqueSources.push(first);
        duplicates.push(...duplicateList);
        
        console.log(`🔍 URL ${url}:`);
        console.log(`  Оставляем: ${first.name} (ID: ${first.id}, дата: ${first.date_created || first.created_at})`);
        console.log(`  Удаляем: ${duplicateList.map(d => `${d.name} (ID: ${d.id})`).join(', ')}`);
      } else {
        uniqueSources.push(sources[0]);
      }
    }

    console.log(`📈 Статистика: уникальных ${uniqueSources.length}, дубликатов ${duplicates.length}`);

    if (duplicates.length === 0) {
      console.log('✅ Дубликаты источников не найдены');
      return;
    }

    // Удаляем дубликаты
    console.log(`🗑️ Удаляем ${duplicates.length} дубликатов...`);
    let removedCount = 0;
    let failedCount = 0;

    for (const duplicate of duplicates) {
      try {
        await axios.delete(
          `${directusUrl}/items/campaign_content_sources/${duplicate.id}`,
          {
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`✅ Удален: ${duplicate.name} (ID: ${duplicate.id})`);
        removedCount++;
      } catch (err) {
        console.error(`❌ Ошибка удаления ${duplicate.name} (ID: ${duplicate.id}):`, err.response?.data || err.message);
        failedCount++;
      }
    }

    console.log(`\n📋 ИТОГИ:`);
    console.log(`✅ Успешно удалено: ${removedCount}`);
    console.log(`❌ Не удалось удалить: ${failedCount}`);
    console.log(`📊 Уникальных источников осталось: ${uniqueSources.length}`);
    
    if (removedCount > 0) {
      console.log('\n🎉 Дубликаты успешно удалены! Теперь можно сделать поле URL уникальным в Directus.');
    }

  } catch (error) {
    console.error('❌ Критическая ошибка:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Запускаем скрипт
removeDuplicateSources();