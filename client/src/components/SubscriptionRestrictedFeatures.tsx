import { SubscriptionGuard } from './SubscriptionGuard';

/**
 * Демонстрационный компонент для показа ограничений подписки
 * Этот файл можно удалить после тестирования
 */
export function SubscriptionRestrictedFeatures() {
  return (
    <div className="space-y-6 p-6">
      <h2 className="text-xl font-bold">Демонстрация ограничений подписки</h2>
      
      {/* Генерация контента */}
      <SubscriptionGuard feature="Генерация контента с AI">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800">Генерация контента с AI</h3>
          <p className="text-green-700">Функция доступна - вы можете генерировать контент с помощью Claude, Gemini, DeepSeek и Qwen.</p>
        </div>
      </SubscriptionGuard>

      {/* Генерация изображений */}
      <SubscriptionGuard feature="Генерация изображений">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800">Генерация изображений</h3>
          <p className="text-green-700">Функция доступна - вы можете создавать изображения с помощью FAL AI.</p>
        </div>
      </SubscriptionGuard>

      {/* Улучшение текста */}
      <SubscriptionGuard feature="Улучшение текста с AI">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800">Улучшение текста с AI</h3>
          <p className="text-green-700">Функция доступна - вы можете улучшать тексты с помощью различных AI сервисов.</p>
        </div>
      </SubscriptionGuard>

      {/* Публикация в соцсети */}
      <SubscriptionGuard feature="Публикация в социальные сети">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800">Публикация в социальные сети</h3>
          <p className="text-green-700">Функция доступна - вы можете публиковать контент в VK, Telegram, Instagram и Facebook.</p>
        </div>
      </SubscriptionGuard>

      {/* Аналитика */}
      <SubscriptionGuard feature="Просмотр аналитики">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800">Просмотр аналитики</h3>
          <p className="text-green-700">Функция доступна - вы можете просматривать статистику по кампаниям и платформам.</p>
        </div>
      </SubscriptionGuard>
    </div>
  );
}