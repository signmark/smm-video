/**
 * Маппинг ошибок API на локализованные сообщения (ru/en/es).
 * Используется во всех сервисах генерации изображений.
 */

const errors: Record<string, Record<string, string>> = {
  // OpenAI ошибки
  openai_billing: {
    ru: 'Достигнут лимит расходов OpenAI. Пополните баланс или увеличьте лимит в настройках биллинга на platform.openai.com.',
    en: 'OpenAI billing hard limit reached. Top up your balance or increase the limit at platform.openai.com/billing.',
    es: 'Límite de facturación de OpenAI alcanzado. Recargue su saldo o aumente el límite en platform.openai.com/billing.',
  },
  openai_quota: {
    ru: 'Исчерпана квота API OpenAI. Проверьте биллинг на platform.openai.com.',
    en: 'OpenAI API quota exhausted. Check your billing at platform.openai.com.',
    es: 'Cuota de API de OpenAI agotada. Verifique su facturación en platform.openai.com.',
  },
  openai_rate_limit: {
    ru: 'Превышен лимит запросов OpenAI. Подождите несколько минут и попробуйте снова.',
    en: 'OpenAI rate limit exceeded. Wait a few minutes and try again.',
    es: 'Límite de velocidad de OpenAI excedido. Espere unos minutos e intente de nuevo.',
  },
  openai_invalid_key: {
    ru: 'Невалидный API ключ OpenAI. Проверьте ключ в настройках.',
    en: 'Invalid OpenAI API key. Check your key in settings.',
    es: 'Clave de API de OpenAI inválida. Verifique su clave en la configuración.',
  },
  openai_content_policy: {
    ru: 'Запрос отклонён политикой контента OpenAI. Измените промт и попробуйте снова.',
    en: 'Request rejected by OpenAI content policy. Modify your prompt and try again.',
    es: 'Solicitud rechazada por la política de contenido de OpenAI. Modifique su prompt e intente de nuevo.',
  },

  // Gemini ошибки
  gemini_billing: {
    ru: 'Достигнут лимит расходов Gemini. Пополните биллинг Google Cloud.',
    en: 'Gemini billing limit reached. Top up Google Cloud billing.',
    es: 'Límite de facturación de Gemini alcanzado. Recargue la facturación de Google Cloud.',
  },
  gemini_quota: {
    ru: 'Исчерпана квота Gemini API. Проверьте лимиты в Google AI Studio.',
    en: 'Gemini API quota exhausted. Check limits in Google AI Studio.',
    es: 'Cuota de API de Gemini agotada. Verifique los límites en Google AI Studio.',
  },
  gemini_safety: {
    ru: 'Запрос заблокирован системой безопасности Gemini. Измените промт.',
    en: 'Request blocked by Gemini safety system. Modify your prompt.',
    es: 'Solicitud bloqueada por el sistema de seguridad de Gemini. Modifique su prompt.',
  },

  // Общие
  key_not_found: {
    ru: 'API ключ не найден. Добавьте ключ в настройках.',
    en: 'API key not found. Add a key in settings.',
    es: 'Clave de API no encontrada. Agregue una clave en la configuración.',
  },
  timeout: {
    ru: 'Превышено время ожидания ответа. Попробуйте снова.',
    en: 'Response timeout. Please try again.',
    es: 'Tiempo de espera agotado. Intente de nuevo.',
  },
  subscription_expired: {
    ru: 'Подписка истекла. Выберите тариф для продолжения.',
    en: 'Subscription expired. Choose a plan to continue.',
    es: 'Suscripción expirada. Elija un plan para continuar.',
  },
  generic: {
    ru: 'Произошла ошибка при генерации. Попробуйте снова.',
    en: 'An error occurred during generation. Please try again.',
    es: 'Ocurrió un error durante la generación. Intente de nuevo.',
  },
};

/**
 * Возвращает локализованное сообщение ошибки по ключу.
 * @param key Ключ ошибки (openai_billing, timeout, etc.)
 * @param locale Язык пользователя (ru, en, es)
 */
export function localizedError(key: string, locale: string = 'ru'): string {
  const entry = errors[key];
  if (!entry) return key;
  return entry[locale] || entry['en'] || entry['ru'] || key;
}

/**
 * Определяет ключ ошибки по тексту от API провайдера.
 */
export function classifyOpenaiError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('billing hard limit') || m.includes('billing limit')) return 'openai_billing';
  if (m.includes('exceeded your current quota') || m.includes('quota')) return 'openai_quota';
  if (m.includes('rate limit') || m.includes('too many requests')) return 'openai_rate_limit';
  if (m.includes('invalid api key') || m.includes('incorrect api key')) return 'openai_invalid_key';
  if (m.includes('content_policy') || m.includes('safety')) return 'openai_content_policy';
  return 'generic';
}

export function classifyGeminiError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('billing') || m.includes('403')) return 'gemini_billing';
  if (m.includes('quota') || m.includes('resource_exhausted')) return 'gemini_quota';
  if (m.includes('safety') || m.includes('blocked')) return 'gemini_safety';
  return 'generic';
}
