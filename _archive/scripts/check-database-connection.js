/**
 * Проверка connection string для PostgreSQL
 * Находим правильные параметры подключения для N8N
 */

async function checkDatabaseConnection() {
  console.log('=== ПРОВЕРКА DATABASE CONNECTION ===\n');

  // Выводим все доступные переменные окружения
  console.log('🔍 Переменные окружения базы данных:');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'присутствует' : 'отсутствует');
  console.log('PGHOST:', process.env.PGHOST || 'не задан');
  console.log('PGPORT:', process.env.PGPORT || 'не задан');
  console.log('PGUSER:', process.env.PGUSER || 'не задан');
  console.log('PGPASSWORD:', process.env.PGPASSWORD ? 'присутствует' : 'отсутствует');
  console.log('PGDATABASE:', process.env.PGDATABASE || 'не задан');

  if (process.env.DATABASE_URL) {
    // Парсим DATABASE_URL для получения компонентов
    try {
      const url = new URL(process.env.DATABASE_URL);
      console.log('\n📋 Компоненты DATABASE_URL:');
      console.log('Host:', url.hostname);
      console.log('Port:', url.port || '5432');
      console.log('Database:', url.pathname.substring(1));
      console.log('Username:', url.username);
      console.log('Password:', url.password ? '***присутствует***' : 'отсутствует');
      console.log('SSL:', url.searchParams.get('sslmode') || 'не указан');

      console.log('\n🔧 Для N8N PostgreSQL node используйте:');
      console.log('Host:', url.hostname);
      console.log('Port:', url.port || '5432');
      console.log('Database:', url.pathname.substring(1));
      console.log('User:', url.username);
      console.log('Password:', url.password);
      console.log('SSL Mode: require');

    } catch (error) {
      console.error('❌ Ошибка парсинга DATABASE_URL:', error.message);
    }
  }

  // Проверяем подключение через Directus API
  console.log('\n🧪 Тестирование через Directus API...');
  try {
    const response = await fetch(process.env.DIRECTUS_URL + '/items/global_api_keys?limit=1', {
      headers: {
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Directus API доступен');
      console.log(`📊 Записей в global_api_keys: ${data.data?.length || 0}`);
    } else {
      console.log('❌ Directus API недоступен:', response.status);
    }
  } catch (error) {
    console.error('❌ Ошибка Directus API:', error.message);
  }

  console.log('\n💡 РЕШЕНИЕ ПРОБЛЕМЫ invalid_client:');
  console.log('1. Обновите connection string в N8N PostgreSQL node');
  console.log('2. Убедитесь что поле api_secret существует в таблице');
  console.log('3. Проверьте что запись YouTube содержит правильные данные');
  console.log('4. Перезапустите N8N workflow после обновления подключения');
}

checkDatabaseConnection();