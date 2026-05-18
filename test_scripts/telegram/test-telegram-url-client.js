
const formatTelegramUrl = (url) => {
  if (!url) return null;
  if (!url.includes("t.me")) return url;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return url;

    // Обработка URL с отрицательными ID каналов, начинающимися с -100
    if (pathParts[0].startsWith("-100")) {
      const channelId = pathParts[0].substring(4); // Убираем -100
      const messageId = pathParts.length > 1 ? pathParts[1] : "";
      return `https://t.me/c/${channelId}${messageId ? `/${messageId}` : ""}`;
    }

    // Обработка URL с другими отрицательными ID каналов
    if (pathParts[0].startsWith("-") && !pathParts[0].startsWith("-100")) {
      const channelId = pathParts[0].substring(1); // Убираем только минус
      const messageId = pathParts.length > 1 ? pathParts[1] : "";
      return `https://t.me/c/${channelId}${messageId ? `/${messageId}` : ""}`;
    }

    // Остальная логика форматирования URL
    return url;
  } catch (error) {
    console.error("Ошибка при форматировании URL Telegram:", error);
    return url;
  }
};

console.log("🔍 Тест форматирования URL Telegram в интерфейсе");
const url = "https://t.me/-1002302366310/12345";
console.log("📋 Исходный URL: " + url);

const formattedUrl = formatTelegramUrl(url);
console.log("📋 Форматированный URL: " + formattedUrl);
console.log("✅ Тест успешно завершен!");

