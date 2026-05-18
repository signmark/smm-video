import { useEffect } from 'react';

export default function TelegramTestPage() {
  useEffect(() => {
    // Перенаправляем на HTML-страницу с тестом
    window.location.href = '/telegram-html-test.html';
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Перенаправление на инструмент тестирования Telegram...</h1>
        <p>Если вы не были перенаправлены автоматически, <a href="/telegram-html-test.html" className="text-blue-500 hover:underline">нажмите здесь</a>.</p>
      </div>
    </div>
  );
}