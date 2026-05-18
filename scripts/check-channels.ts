import axios from 'axios';

async function check() {
  const token = process.env.DIRECTUS_TOKEN;
  const res = await axios.get('https://directus.nplanner.ru/items/telegram_channels', { 
    headers: { Authorization: `Bearer ${token}` },
    params: {
      limit: -1,
      fields: 'username,title,category_id,is_active'
    }
  });
  
  const channels = res.data.data;
  console.log(`\n📊 Всего каналов в базе: ${channels.length}\n`);
  
  // Группируем по category_id
  const byCategory: Record<string, any[]> = {};
  channels.forEach((ch: any) => {
    const catId = ch.category_id || 'null';
    if (!byCategory[catId]) byCategory[catId] = [];
    byCategory[catId].push(ch);
  });
  
  console.log('По категориям:');
  Object.entries(byCategory).forEach(([catId, chs]) => {
    console.log(`  ${catId}: ${chs.length} каналов`);
    if (catId === 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8') {
      console.log('    Entertainment каналы:');
      chs.forEach((ch: any) => {
        console.log(`      - @${ch.username} (is_active: ${ch.is_active})`);
      });
    }
  });
  
  // Проверяем is_active
  const active = channels.filter((ch: any) => ch.is_active === true);
  const inactive = channels.filter((ch: any) => ch.is_active === false);
  const nullActive = channels.filter((ch: any) => ch.is_active === null || ch.is_active === undefined);
  
  console.log(`\n✅ is_active=true: ${active.length}`);
  console.log(`❌ is_active=false: ${inactive.length}`);
  console.log(`❓ is_active=null/undefined: ${nullActive.length}`);
}

check();
