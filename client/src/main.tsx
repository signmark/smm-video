import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";

// Инициализируем браузерный логгер для контроля логов в зависимости от окружения
import "./utils/logger";

createRoot(document.getElementById("root")!).render(<App />);

// Register Service Worker for PWA support (ТОЛЬКО в production для избежания кеширования в dev)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('[PWA] Service Worker registered:', registration.scope);
        
        // Автоматически активируем новую версию
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available, activating...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('[PWA] Service Worker registration failed:', error);
      });
  });
} else if (!import.meta.env.PROD) {
  console.log('[DEV] Service Worker отключен в dev режиме для избежания кеширования');
}
