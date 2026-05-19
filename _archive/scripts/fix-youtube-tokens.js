/**
 * Скрипт для исправления YouTube токенов в базе данных
 * Удаляет пробелы и другие невалидные символы из accessToken и refreshToken
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || "https://directus.roboflow.space";
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || "qmn9oTXdwCKrCR3Pj-FmPNZsj-0WayJz";

async function fixYouTubeTokens() {
  try {
    console.log('🔧 Начинаем исправление YouTube токенов...');

    // Получаем все кампании
    const campaignsResponse = await fetch(`${DIRECTUS_URL}/items/user_campaigns?limit=-1`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!campaignsResponse.ok) {
      throw new Error(`Ошибка получения кампаний: ${campaignsResponse.statusText}`);
    }

    const campaignsData = await campaignsResponse.json();
    const campaigns = campaignsData.data;

    console.log(`📊 Найдено кампаний: ${campaigns.length}`);

    let fixedCount = 0;
    let checkedCount = 0;

    for (const campaign of campaigns) {
      const socialSettings = campaign.social_media_settings;
      
      if (socialSettings && socialSettings.youtube) {
        checkedCount++;
        const youtube = socialSettings.youtube;
        
        console.log(`\n🔍 Проверяем кампанию: ${campaign.title} (ID: ${campaign.id})`);
        
        let needsUpdate = false;
        const updatedYoutube = { ...youtube };
        
        // Проверяем и очищаем accessToken
        if (youtube.accessToken) {
          const originalToken = youtube.accessToken;
          const cleanToken = originalToken.trim().replace(/\s+/g, '');
          
          if (originalToken !== cleanToken) {
            console.log(`   ⚠️  AccessToken содержит пробелы (длина: ${originalToken.length} → ${cleanToken.length})`);
            updatedYoutube.accessToken = cleanToken;
            needsUpdate = true;
          } else {
            console.log(`   ✅ AccessToken чистый (длина: ${cleanToken.length})`);
          }
        }
        
        // Проверяем и очищаем refreshToken
        if (youtube.refreshToken) {
          const originalRefresh = youtube.refreshToken;
          const cleanRefresh = originalRefresh.trim().replace(/\s+/g, '');
          
          if (originalRefresh !== cleanRefresh) {
            console.log(`   ⚠️  RefreshToken содержит пробелы (длина: ${originalRefresh.length} → ${cleanRefresh.length})`);
            updatedYoutube.refreshToken = cleanRefresh;
            needsUpdate = true;
          } else {
            console.log(`   ✅ RefreshToken чистый (длина: ${cleanRefresh.length})`);
          }
        }
        
        // Обновляем кампанию если нужно
        if (needsUpdate) {
          const updatedSettings = {
            ...socialSettings,
            youtube: updatedYoutube
          };
          
          const updateResponse = await fetch(`${DIRECTUS_URL}/items/user_campaigns/${campaign.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              social_media_settings: updatedSettings
            })
          });
          
          if (updateResponse.ok) {
            console.log(`   🔧 Токены исправлены и сохранены`);
            fixedCount++;
          } else {
            console.log(`   ❌ Ошибка сохранения: ${updateResponse.statusText}`);
          }
        }
      }
    }
    
    console.log(`\n📈 Статистика:`);
    console.log(`   Кампаний с YouTube: ${checkedCount}`);
    console.log(`   Исправлено токенов: ${fixedCount}`);
    
    if (fixedCount > 0) {
      console.log(`\n✅ Исправление завершено! YouTube токены очищены от пробелов.`);
      console.log(`💡 Теперь YouTube Setup Wizard должен работать корректно.`);
    } else {
      console.log(`\n✅ Все токены уже в порядке, исправление не требуется.`);
    }

  } catch (error) {
    console.error('❌ Ошибка при исправлении токенов:', error.message);
  }
}

// Запускаем исправление
fixYouTubeTokens();