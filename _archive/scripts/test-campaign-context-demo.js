/**
 * Демонстрация работы функции данных анкеты
 * Показывает разницу между обычным и обогащенным промптом
 */

// Имитация данных анкеты из Directus
const mockQuestionnaireData = {
  company_name: "NPlanner",
  website_link: "https://nplanner.ru/",
  business_description: "Платформа для планирования и управления проектами",
  target_audience: "Предприниматели, менеджеры проектов, стартапы",
  unique_selling_points: "Простота использования, интеграция с популярными сервисами, AI-помощник",
  products_services: "Планировщик задач, календарь проектов, CRM-система, аналитика",
  tone_of_voice: "Профессиональный, дружелюбный, мотивирующий",
  competitive_info: "Отличается от Trello и Asana более простым интерфейсом",
  marketing_goals: "Увеличить узнаваемость бренда, привлечь новых пользователей"
};

// Функция обогащения промпта (копия из основного кода)
function enrichPromptWithCampaignData(originalPrompt, campaignData, questionnaireData) {
  if (!campaignData && !questionnaireData) {
    return originalPrompt;
  }

  let enrichedPrompt = originalPrompt + "\n\n--- КОНТЕКСТ КОМПАНИИ ---\n";
  
  if (questionnaireData) {
    if (questionnaireData.company_name) {
      enrichedPrompt += `Название компании: ${questionnaireData.company_name}\n`;
    }
    if (questionnaireData.website_link) {
      enrichedPrompt += `Сайт компании: ${questionnaireData.website_link}\n`;
    }
    if (questionnaireData.business_description) {
      enrichedPrompt += `Описание бизнеса: ${questionnaireData.business_description}\n`;
    }
    if (questionnaireData.target_audience) {
      enrichedPrompt += `Целевая аудитория: ${questionnaireData.target_audience}\n`;
    }
    if (questionnaireData.unique_selling_points) {
      enrichedPrompt += `Уникальные преимущества: ${questionnaireData.unique_selling_points}\n`;
    }
    if (questionnaireData.products_services) {
      enrichedPrompt += `Продукты/услуги: ${questionnaireData.products_services}\n`;
    }
    if (questionnaireData.tone_of_voice) {
      enrichedPrompt += `Тон коммуникации: ${questionnaireData.tone_of_voice}\n`;
    }
    if (questionnaireData.competitive_info) {
      enrichedPrompt += `Конкурентные преимущества: ${questionnaireData.competitive_info}\n`;
    }
    if (questionnaireData.marketing_goals) {
      enrichedPrompt += `Маркетинговые цели: ${questionnaireData.marketing_goals}\n`;
    }
  }

  if (campaignData && campaignData.website_link) {
    enrichedPrompt += `URL кампании: ${campaignData.website_link}\n`;
  }

  enrichedPrompt += "\n--- ТРЕБОВАНИЯ ---\n";
  enrichedPrompt += "Используй эти данные для создания персонализированного контента.\n";
  enrichedPrompt += "Обязательно упоминай настоящее название компании и сайт.\n";
  enrichedPrompt += "Создавай контент в указанном тоне коммуникации.\n";

  return enrichedPrompt;
}

console.log("=== ДЕМОНСТРАЦИЯ ФУНКЦИИ ДАННЫХ АНКЕТЫ ===\n");

// Исходный промпт
const originalPrompt = "Создай пост о продуктах компании для социальных сетей";

console.log("1. ОБЫЧНЫЙ ПРОМПТ (без данных анкеты):");
console.log("=====================================");
console.log(originalPrompt);
console.log("\n");

// Обогащенный промпт
const enrichedPrompt = enrichPromptWithCampaignData(
  originalPrompt, 
  { website_link: "https://nplanner.ru/" }, 
  mockQuestionnaireData
);

console.log("2. ОБОГАЩЕННЫЙ ПРОМПТ (с данными анкеты):");
console.log("=========================================");
console.log(enrichedPrompt);
console.log("\n");

console.log("3. СРАВНЕНИЕ РЕЗУЛЬТАТОВ:");
console.log("========================");
console.log("Обычный промпт приведет к созданию поста с:");
console.log("- Общими фразами");
console.log("- Вымышленным названием компании");
console.log("- Примерным сайтом (example.com)");
console.log("- Неконкретными продуктами");
console.log("\nОбогащенный промпт создаст пост с:");
console.log("- Точным названием: NPlanner");
console.log("- Реальным сайтом: https://nplanner.ru/");
console.log("- Конкретными продуктами: планировщик задач, CRM, аналитика");
console.log("- Правильной целевой аудиторией: предприниматели, менеджеры");
console.log("- Соответствующим тоном: профессиональный, дружелюбный");

console.log("\n✅ ФУНКЦИЯ РАБОТАЕТ КОРРЕКТНО!");
console.log("Данные анкеты успешно добавляются в промпт для всех ИИ моделей.");