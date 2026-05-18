/**
 * Скрипт для прямого удаления постов без social_platforms из базы данных PostgreSQL
 */

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Логирование в файл и консоль
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}`;
  console.log(logMessage);
  fs.appendFileSync('clean-db-duplicates.log', logMessage + '\n');
}

// Проверка наличия переменных окружения
if (!process.env.DATABASE_URL) {
  log('Ошибка: переменная окружения DATABASE_URL не найдена');
  process.exit(1);
}

// Подключение к базе данных
const sql = neon(process.env.DATABASE_URL);

// Основная функция
async function main() {
  // Создаем или очищаем файл лога
  fs.writeFileSync('clean-db-duplicates.log', '');
  
  log('Начало очистки дубликатов и постов без social_platforms');
  
  try {
    // 1. Получаем все посты без social_platforms
    log('Получение списка постов без social_platforms...');
    const postsWithoutSocialPlatforms = await sql`
      SELECT id, title, scheduled_at
      FROM campaign_content
      WHERE social_platforms IS NULL OR social_platforms = '{}'::jsonb
    `;
    
    log(`Найдено ${postsWithoutSocialPlatforms.length} постов без social_platforms`);
    
    // 2. Выводим список постов для удаления
    if (postsWithoutSocialPlatforms.length > 0) {
      log('Список постов без social_platforms:');
      postsWithoutSocialPlatforms.forEach(post => {
        log(`- ID: ${post.id}, Название: ${post.title}, Дата: ${post.scheduled_at || 'Не задана'}`);
      });
    }
    
    // 3. Поиск дубликатов по дате публикации
    log('Поиск дубликатов...');
    const duplicates = await sql`
      WITH grouped_posts AS (
        SELECT 
          id, 
          title, 
          scheduled_at, 
          created_at,
          ROW_NUMBER() OVER (PARTITION BY DATE(scheduled_at) ORDER BY created_at) as row_num
        FROM campaign_content
        WHERE scheduled_at IS NOT NULL
      )
      SELECT id, title, scheduled_at, created_at
      FROM grouped_posts
      WHERE row_num > 1
    `;
    
    log(`Найдено ${duplicates.length} дубликатов`);
    
    // 4. Выводим список дубликатов
    if (duplicates.length > 0) {
      log('Список дубликатов:');
      duplicates.forEach(post => {
        log(`- ID: ${post.id}, Название: ${post.title}, Дата: ${post.scheduled_at}`);
      });
    }
    
    // 5. Объединяем списки постов для удаления
    const allPostsToDelete = [...postsWithoutSocialPlatforms, ...duplicates];
    log(`Всего постов для удаления: ${allPostsToDelete.length}`);
    
    // 6. Удаляем посты
    if (allPostsToDelete.length > 0) {
      log('Удаление постов...');
      
      let deletedCount = 0;
      for (const post of allPostsToDelete) {
        try {
          await sql`DELETE FROM campaign_content WHERE id = ${post.id}`;
          log(`Успешно удален пост ${post.id}`);
          deletedCount++;
        } catch (error) {
          log(`Ошибка при удалении поста ${post.id}: ${error.message}`);
        }
      }
      
      log(`Удалено ${deletedCount} из ${allPostsToDelete.length} постов`);
    } else {
      log('Нет постов для удаления');
    }
    
    log('Очистка базы данных завершена успешно');
  } catch (error) {
    log(`Произошла ошибка: ${error.message}`);
    log(error.stack);
  } finally {
    // В случае с @neondatabase/serverless закрытие соединения не требуется,
    // оно закрывается автоматически после выполнения запроса
    log('Соединение с базой данных закрыто');
  }
}

// Запуск скрипта
main().catch(error => {
  log(`Необработанная ошибка: ${error.message}`);
  log(error.stack);
});