import axios from 'axios';

const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN не задан');
const URL = 'https://directus.nplanner.ru';

async function main() {
  console.log('🔍 Поиск дублей каналов по полю link...\n');
  
  let offset = 0;
  const limit = 1000;
  const linkMap = new Map<string, string[]>(); // link -> [id, id, ...]
  let total = 0;
  
  // Собираем все каналы
  while (true) {
    const res = await axios.get(`${URL}/items/telegram_channels`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
      params: { fields: 'id,link,username', limit, offset, sort: 'id' }
    });
    
    const channels = res.data.data;
    if (!channels || channels.length === 0) break;
    
    for (const ch of channels) {
      const link = ch.link || ch.username;
      if (!linkMap.has(link)) {
        linkMap.set(link, []);
      }
      linkMap.get(link)!.push(ch.id);
    }
    
    total += channels.length;
    offset += limit;
    process.stdout.write(`\r   Проверено: ${total}`);
  }
  
  console.log(`\n\n📊 Всего каналов: ${total}`);
  
  // Находим дубли
  const duplicates: string[] = [];
  for (const [link, ids] of linkMap) {
    if (ids.length > 1) {
      // Оставляем первый (самый старый), удаляем остальные
      duplicates.push(...ids.slice(1));
    }
  }
  
  console.log(`🗑️  Дублей для удаления: ${duplicates.length}`);
  
  if (duplicates.length === 0) {
    console.log('✅ Дублей не найдено!');
    return;
  }
  
  // Удаляем пакетами по 100
  const batchSize = 100;
  let deleted = 0;
  
  for (let i = 0; i < duplicates.length; i += batchSize) {
    const batch = duplicates.slice(i, i + batchSize);
    
    try {
      await axios.delete(`${URL}/items/telegram_channels`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        data: batch
      });
      deleted += batch.length;
      process.stdout.write(`\r   Удалено: ${deleted}/${duplicates.length}`);
    } catch (e: any) {
      console.error(`\n❌ Ошибка: ${e.response?.data?.errors?.[0]?.message || e.message}`);
    }
  }
  
  console.log(`\n\n✅ Удалено ${deleted} дублей`);
  
  // Финальный подсчёт
  const final = await axios.get(`${URL}/items/telegram_channels?meta=total_count&limit=1`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  console.log(`📊 Осталось каналов: ${final.data.meta.total_count}`);
}

main().catch(console.error);
