/**
 * Тест post-processing логики для заполнения пустых полей
 */

// Имитируем ответ DeepSeek с пустыми полями
const mockDeepSeekResponse = {
  "companyName": "Киберспорт",
  "contactInfo": "",
  "businessDescription": "Портал о киберспорте, турнирах и играх",
  "mainDirections": "Освещение киберспортивных событий, турниров по играм, новости игровой индустрии",
  "brandImage": "Информационный ресурс для любителей киберспорта и игровой индустрии",
  "productsServices": "Новости, аналитика, расписание турниров, результаты матчей",
  "targetAudience": "Геймеры, фанаты киберспорта, участники турниров, зрители киберспортивных событий",
  "customerResults": "Актуальная информация о турнирах, новости игровой индустрии, аналитика матчей",
  "companyFeatures": "Специализированный портал, фокусирующийся на киберспорте и игровой индустрии",
  "businessValues": "",
  "productBeliefs": "",
  "competitiveAdvantages": "Экспертность в теме киберспорта, оперативное освещение событий",
  "marketingExpectations": "Привлечение большего числа посетителей, увеличение охвата аудитории, монетизация трафика"
};

const url = "https://www.cybersport.ru/tournaments/cs2/blast-tv-major-2025";

console.log('=== ТЕСТ POST-PROCESSING ЛОГИКИ ===');
console.log('URL:', url);
console.log('Исходные поля:');
console.log('- businessValues:', JSON.stringify(mockDeepSeekResponse.businessValues));
console.log('- productBeliefs:', JSON.stringify(mockDeepSeekResponse.productBeliefs));

// Применяем post-processing логику
let result = { ...mockDeepSeekResponse };

console.log('\n=== ПРИМЕНЕНИЕ POST-PROCESSING ===');

// Проверка businessValues
console.log('DEBUG: businessValues после парсинга:', JSON.stringify(result.businessValues));
console.log('DEBUG: productBeliefs после парсинга:', JSON.stringify(result.productBeliefs));

if (!result.businessValues || result.businessValues.trim() === '') {
  if (url.toLowerCase().includes('cybersport') || url.toLowerCase().includes('gaming') || url.toLowerCase().includes('esport')) {
    result.businessValues = "Честная игра, развитие киберспорта, поддержка игрового сообщества";
    console.log('🔧 Добавлены businessValues для киберспорта');
  } else if (result.businessDescription && result.businessDescription.toLowerCase().includes('портал')) {
    result.businessValues = "Достоверность информации, актуальность контента, служение сообществу";
    console.log('🔧 Добавлены businessValues для портала');
  } else {
    result.businessValues = "Качество услуг, клиентоориентированность, профессионализм";
    console.log('🔧 Добавлены общие businessValues');
  }
}

if (!result.productBeliefs || result.productBeliefs.trim() === '') {
  if (url.toLowerCase().includes('cybersport') || url.toLowerCase().includes('gaming') || url.toLowerCase().includes('esport')) {
    result.productBeliefs = "Киберспорт - это спорт будущего, заслуживающий профессионального освещения";
    console.log('🔧 Добавлены productBeliefs для киберспорта');
  } else if (result.productsServices && result.productsServices.toLowerCase().includes('информация')) {
    result.productBeliefs = "Информация должна быть доступной, понятной и полезной для каждого";
    console.log('🔧 Добавлены productBeliefs для информационного ресурса');
  } else {
    result.productBeliefs = "Продукт должен решать реальные потребности пользователей";
    console.log('🔧 Добавлены общие productBeliefs');
  }
}

console.log('\n=== РЕЗУЛЬТАТ ===');
console.log('Финальные поля:');
console.log('- businessValues:', result.businessValues);
console.log('- productBeliefs:', result.productBeliefs);

console.log('\n=== ПОЛНЫЙ РЕЗУЛЬТАТ ===');
console.log(JSON.stringify(result, null, 2));