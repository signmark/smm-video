/**
 * 🔧 Конфигурация URL для SMM Manager
 * 
 * Измените этот URL для разных клиентов или копий платформы.
 * После изменения просто обновите страницу - все кнопки будут вести на новый URL.
 * 
 * Примеры:
 * - Клиентская версия: 'https://smm.omemo.tech'
 * - Личная копия: 'https://smm.omemo.tech'
 * - Dev-версия: 'https://smm.roboflow.space'
 */

const APP_CONFIG = {
    // URL главного приложения SMM Manager
    appUrl: 'https://smm.omemo.tech',
    
    // Дополнительные настройки (опционально)
    // supportEmail: 'support@smmniap.pw',
    // telegramBot: '@SMM_Manager_official_Bot'
};

// Функция для получения URL приложения
function getAppUrl() {
    return APP_CONFIG.appUrl;
}
