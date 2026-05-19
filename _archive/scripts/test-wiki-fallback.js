/**
 * Тестирование логики fallback для Wikipedia страниц
 */

// Эмуляция логики из server/routes.ts
function testWikipediaFallback(url, websiteContent = "") {
  const urlType = url.toLowerCase();
  console.log(`URL: ${url}`);
  console.log(`Проверка wiki: ${urlType.includes('wiki')}`);
  
  if (urlType.includes('wiki')) {
    console.log(`!!! НОВАЯ WIKI ЛОГИКА АКТИВИРОВАНА !!!`);
    let wikiTopic = "общая тема";
    
    // Извлекаем тему из URL Wikipedia
    const wikiMatch = url.match(/\/wiki\/([^#?]+)/);
    if (wikiMatch) {
      const rawTopic = decodeURIComponent(wikiMatch[1]).replace(/_/g, ' ');
      wikiTopic = rawTopic;
      console.log(`Извлечена тема Wikipedia: "${wikiTopic}"`);
    } else {
      console.log(`Тема Wikipedia НЕ извлечена из URL: "${url}"`);
    }
    
    // Анализируем тему для специфической генерации контента
    if (wikiTopic.toLowerCase().includes('сало') || (websiteContent && websiteContent.toLowerCase().includes('сало'))) {
      console.log(`Обнаружена тема "сало" - создаем специализированный контент`);
      return {
        companyName: "Производитель мясных деликатесов",
        businessDescription: "Производство и реализация качественных мясных продуктов, включая сало традиционного посола",
        businessValues: "Натуральность продуктов, соблюдение традиций, забота о качестве",
        productBeliefs: "Сало - это традиционный, питательный продукт с высокой пищевой ценностью"
      };
    } else {
      // Общий fallback для других Wikipedia страниц
      return {
        companyName: `Информационный проект по теме "${wikiTopic}"`,
        businessDescription: `Образовательный ресурс, освещающий тему "${wikiTopic}"`,
        businessValues: "Достоверность информации, открытость знаний, образовательная миссия",
        productBeliefs: "Знания должны быть доступны каждому, информация должна быть достоверной"
      };
    }
  }
  
  return null;
}

// Тестирование с URL сала
console.log("=== ТЕСТ 1: Wikipedia страница о сале ===");
const saloResult = testWikipediaFallback("https://ru.wikipedia.org/wiki/%D0%A1%D0%B0%D0%BB%D0%BE");
console.log("Результат:", JSON.stringify(saloResult, null, 2));

console.log("\n=== ТЕСТ 2: Wikipedia страница о программировании ===");
const programmingResult = testWikipediaFallback("https://ru.wikipedia.org/wiki/Программирование");
console.log("Результат:", JSON.stringify(programmingResult, null, 2));

console.log("\n=== ТЕСТ 3: Обычный сайт ===");
const normalResult = testWikipediaFallback("https://example.com");
console.log("Результат:", normalResult);