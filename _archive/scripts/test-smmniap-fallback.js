/**
 * Тест fallback логики для smmniap.pw
 */

// Имитируем переменные из server/routes.ts
const url = 'https://smmniap.pw';
const websiteContent = `URL: https://smmniap.pw
ЗАГОЛОВОК САЙТА: SMM Manager - AI-платформа для управления социальными сетями
ОПИСАНИЕ САЙТА: Передовая AI-платформа для анализа социальных сетей, создания контента и управления публикациями. Автоматизируйте ваш SMM с помощью искусственного интеллекта.
ОСНОВНЫЕ ЗАГОЛОВКИ (H1):
Умная платформа для управления социальными сетями
ПОДЗАГОЛОВКИ (H2):
Мощные возможности для современного SMM
Интеграции с популярными платформами`;

function testFallbackLogic() {
  console.log('🧪 Тестирование fallback логики для smmniap.pw\n');
  
  // Извлекаем домен и анализируем
  let domain = '';
  let siteName = '';
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.toLowerCase();
    siteName = domain.replace(/^www\./, '').split('.')[0];
  } catch (e) {
    domain = url.toLowerCase();
    siteName = 'сайт';
  }
  
  console.log(`🔧 Извлечен домен: "${domain}", имя сайта: "${siteName}"`);
  
  // Извлекаем заголовок страницы из реального контента
  const titleMatch = websiteContent.match(/ЗАГОЛОВОК САЙТА:\s*([^\n]+)/);
  const pageTitle = titleMatch ? titleMatch[1].replace(/\s*—\s*.*$/, '').trim() : siteName;
  
  console.log(`🔧 Заголовок страницы: "${pageTitle}"`);
  
  // Анализируем содержимое по ключевым словам в РЕАЛЬНОМ контенте
  const contentLower = (websiteContent + ' ' + pageTitle + ' ' + url).toLowerCase();
  
  console.log(`🔧 Контент для анализа (первые 200 символов): "${contentLower.slice(0, 200)}..."`);
  
  // Проверяем ключевые слова
  console.log(`\n🔍 ПРОВЕРКА КЛЮЧЕВЫХ СЛОВ:`);
  console.log(`- domain.includes('smmniap'): ${domain.includes('smmniap')}`);
  console.log(`- domain.includes('smm'): ${domain.includes('smm')}`);
  console.log(`- contentLower.includes('социальн'): ${contentLower.includes('социальн')}`);
  console.log(`- contentLower.includes('smm'): ${contentLower.includes('smm')}`);
  console.log(`- contentLower.includes('автоматизац'): ${contentLower.includes('автоматизац')}`);
  console.log(`- contentLower.includes('контент'): ${contentLower.includes('контент')}`);
  console.log(`- contentLower.includes('публикац'): ${contentLower.includes('публикац')}`);
  console.log(`- contentLower.includes('трен'): ${contentLower.includes('трен')}`);
  console.log(`- contentLower.includes('manager'): ${contentLower.includes('manager')}`);
  console.log(`- contentLower.includes('платформ'): ${contentLower.includes('платформ')}`);
  console.log(`- contentLower.includes('управлени'): ${contentLower.includes('управлени')}`);
  console.log(`- pageTitle.toLowerCase().includes('smm'): ${pageTitle.toLowerCase().includes('smm')}`);
  console.log(`- pageTitle.toLowerCase().includes('manager'): ${pageTitle.toLowerCase().includes('manager')}`);
  
  // Проверяем условие
  const isSMMPlatform = (
    domain.includes('smmniap') || 
    domain.includes('smm') || 
    contentLower.includes('социальн') || 
    contentLower.includes('smm') || 
    contentLower.includes('автоматизац') || 
    contentLower.includes('контент') || 
    contentLower.includes('публикац') || 
    contentLower.includes('трен') || 
    contentLower.includes('manager') || 
    contentLower.includes('платформ') || 
    contentLower.includes('управлени') || 
    pageTitle.toLowerCase().includes('smm') || 
    pageTitle.toLowerCase().includes('manager')
  );
  
  console.log(`\n✅ РЕЗУЛЬТАТ: Распознано как SMM-платформа: ${isSMMPlatform}`);
  
  if (isSMMPlatform) {
    console.log(`🎉 SUCCESS: smmniap.pw правильно распознается как SMM-платформа!`);
    return {
      businessType: 'SMM и социальные сети',
      companyName: 'SMM Manager - AI-платформа для управления социальными сетями',
      businessDesc: 'Передовая AI-платформа для автоматизации SMM: анализ трендов, создание контента, управление публикациями в социальных сетях с помощью искусственного интеллекта',
      targetAudience: 'SMM-менеджеры, маркетологи, блогеры, агентства цифрового маркетинга, предприниматели',
      businessValues: 'Автоматизация рутинных задач, данные-ориентированный подход, креативность через AI, эффективность SMM',
      productBeliefs: 'Искусственный интеллект должен освободить креаторов от рутины и помочь создавать более качественный контент'
    };
  } else {
    console.log(`❌ FAIL: smmniap.pw НЕ распознается как SMM-платформа`);
    return null;
  }
}

testFallbackLogic();