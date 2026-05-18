/**
 * 🐰 Конфигурация для Алисы
 * 
 * Алиса - ваш личный AI-помощник для управления социальными сетями.
 * "Где магия встречается с маркетингом"
 */

const APP_CONFIG = {
    // URL приложения Алиса
    appUrl: 'https://alisa.website',
    
    // Дополнительные настройки
    appName: 'Алиса',
    tagline: 'Алиса знает, что постить',
    supportEmail: 'support@alisa.website',
};

// Функция для получения URL приложения
function getAppUrl() {
    return APP_CONFIG.appUrl;
}

// Функция для получения названия приложения
function getAppName() {
    return APP_CONFIG.appName;
}
