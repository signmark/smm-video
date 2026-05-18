#!/usr/bin/env node

import axios from 'axios';
import { config } from 'dotenv';

config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL || 'admin@roboflow.space';
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;

async function cleanDuplicateSources() {
  try {
    console.log('🔄 Начинаем очистку дублирующихся источников...');
    
    // 1. Авторизация админа
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    if (!authResponse.data?.data?.access_token) {
      throw new Error('Не удалось получить токен администратора');
    }
    
    const adminToken = authResponse.data.data.access_token;
    console.log('✅ Авторизация администратора успешна');
    
    const headers = {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    };
    
    // 2. Получаем все источники
    const sourcesResponse = await axios.get(`${DIRECTUS_URL}/items/campaign_sources?limit=1000`, { headers });
    const sources = sourcesResponse.data.data || [];
    
    console.log(`📊 Найдено источников: ${sources.length}`);
    
    // 3. Группируем по URL для поиска дубликатов
    const urlGroups = {};
    sources.forEach(source => {
      if (!urlGroups[source.url]) {
        urlGroups[source.url] = [];
      }
      urlGroups[source.url].push(source);
    });
    
    // 4. Находим дублирующиеся источники
    const duplicateGroups = Object.entries(urlGroups).filter(([url, group]) => group.length > 1);
    
    console.log(`🔍 Найдено дублирующихся групп: ${duplicateGroups.length}`);
    
    if (duplicateGroups.length === 0) {
      console.log('✅ Дубликаты не найдены, очистка не требуется');
      return;
    }
    
    // 5. Показываем дубликаты перед удалением
    duplicateGroups.forEach(([url, group]) => {
      console.log(`\n📝 URL: ${url}`);
      console.log(`   Источников: ${group.length}`);
      group.forEach((source, index) => {
        console.log(`   ${index + 1}. ID: ${source.id}, Name: ${source.name}${index === 0 ? ' (ОСТАЕТСЯ)' : ' (удаляется)'}`);
      });
    });
    
    // 6. Обновляем тренды - переводим их на первый источник каждой группы
    console.log('\n🔄 Обновляем тренды для использования оставшихся источников...');
    
    for (const [url, group] of duplicateGroups) {
      const keepSource = group[0]; // Оставляем первый источник
      const duplicateIds = group.slice(1).map(s => s.id); // ID дубликатов для удаления
      
      // Обновляем тренды, которые ссылаются на дубликаты
      for (const duplicateId of duplicateIds) {
        try {
          const trendsResponse = await axios.get(`${DIRECTUS_URL}/items/campaign_trends?filter[source_id][_eq]=${duplicateId}`, { headers });
          const trends = trendsResponse.data.data || [];
          
          console.log(`   Обновляем ${trends.length} трендов с source_id ${duplicateId} → ${keepSource.id}`);
          
          for (const trend of trends) {
            await axios.patch(`${DIRECTUS_URL}/items/campaign_trends/${trend.id}`, {
              source_id: keepSource.id
            }, { headers });
          }
        } catch (error) {
          console.warn(`   ⚠️ Ошибка обновления трендов для источника ${duplicateId}:`, error.message);
        }
      }
    }
    
    // 7. Удаляем дублирующиеся источники
    console.log('\n🗑️ Удаляем дублирующиеся источники...');
    
    for (const [url, group] of duplicateGroups) {
      const duplicateIds = group.slice(1).map(s => s.id);
      
      for (const duplicateId of duplicateIds) {
        try {
          await axios.delete(`${DIRECTUS_URL}/items/campaign_sources/${duplicateId}`, { headers });
          console.log(`   ✅ Удален источник ID: ${duplicateId}`);
        } catch (error) {
          console.warn(`   ⚠️ Ошибка удаления источника ${duplicateId}:`, error.message);
        }
      }
    }
    
    console.log('\n✅ Очистка дублирующихся источников завершена');
    console.log(`📊 Удалено источников: ${duplicateGroups.reduce((sum, [url, group]) => sum + group.length - 1, 0)}`);
    
  } catch (error) {
    console.error('❌ Ошибка очистки дублирующихся источников:', error.message);
    process.exit(1);
  }
}

cleanDuplicateSources();