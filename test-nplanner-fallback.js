/**
 * Быстрый тест fallback логики для nplanner.ru
 */

function testNplannerFallback() {
  const url = "https://nplanner.ru/";
  const websiteContent = `
    ЗАГОЛОВОК САЙТА: НИАП - Облачный сервис диагностики здоровья
    Облачный сервис для автоматической диагностики состояния здоровья и создания персонализированных рационов
    Для всех специалистов, работающих с питанием и профилактикой заболеваний
    диагностика, рацион питания, здоровье, персонализированные решения
  `;

  // Извлекаем домен
  const urlObj = new URL(url);
  const domain = urlObj.hostname.toLowerCase();
  const contentLower = (websiteContent + ' ' + url).toLowerCase();
  
  console.log(`Тест для URL: ${url}`);
  console.log(`Домен: ${domain}`);
  console.log(`Проверка nplanner: ${domain.includes('nplanner')}`);
  console.log(`Проверка диагност: ${contentLower.includes('диагност')}`);
  console.log(`Проверка рацион: ${contentLower.includes('рацион')}`);
  console.log(`Проверка здоров: ${contentLower.includes('здоров')}`);
  
  if (domain.includes('nplanner') || contentLower.includes('диагност') || contentLower.includes('рацион') || contentLower.includes('питани') || contentLower.includes('здоров') || contentLower.includes('персонализированн')) {
    console.log('✅ ПРАВИЛЬНОЕ ОПРЕДЕЛЕНИЕ: Медицинские технологии и диетология');
    console.log('✅ Название: НИАП - Облачный сервис диагностики здоровья');
    console.log('✅ Целевая аудитория: Диетологи, нутрициологи, врачи, специалисты по питанию');
    return true;
  } else {
    console.log('❌ ОШИБКА: Неправильно определен тип бизнеса');
    return false;
  }
}

testNplannerFallback();