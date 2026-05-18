import React from 'react';

/**
 * Компонент для отображения ошибки при воспроизведении видео Instagram
 * @param videoUrl URL оригинального видео для перенаправления
 * @returns Компонент с сообщением об ошибке и кнопкой перехода в Instagram
 */
export function InstagramErrorDisplay({ videoUrl }: { videoUrl: string }) {
  return (
    <div className="flex items-center justify-center bg-slate-700 rounded-md h-full w-full p-4 absolute inset-0">
      <div className="text-center text-white">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="48" 
          height="48" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          className="mx-auto mb-3"
        >
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
        <p className="text-sm font-medium">Видео Instagram доступно только в оригинале</p>
        <p className="text-xs mt-1 text-gray-300">Instagram блокирует прямое воспроизведение</p>
        <a 
          href={videoUrl} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-xs mt-3 text-blue-300 hover:underline block bg-blue-900/30 py-2 px-3 rounded-md"
        >
          Открыть в Instagram
        </a>
      </div>
    </div>
  );
}

/**
 * Функция для обработки ошибки воспроизведения видео Instagram
 * @param videoElement HTML-элемент video, в котором произошла ошибка
 * @param videoUrl URL оригинального видео для перенаправления
 */
export function handleInstagramVideoError(videoElement: HTMLVideoElement, videoUrl: string) {

  
  // Скрываем видеоэлемент
  videoElement.style.display = 'none';
  
  // Создаем контейнер для React-компонента ошибки
  const errorContainer = document.createElement('div');
  errorContainer.className = "insta-error-container";
  
  // Добавляем контейнер рядом с видео
  videoElement.parentNode?.appendChild(errorContainer);
  
  // Рендерим наш React-компонент ошибки в контейнер
  // Для простоты используем innerHTML вместо ReactDOM.render
  errorContainer.innerHTML = `
    <div class="flex items-center justify-center bg-slate-700 rounded-md h-full w-full p-4 absolute inset-0">
      <div class="text-center text-white">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-3">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
        <p class="text-sm font-medium">Видео Instagram доступно только в оригинале</p>
        <p class="text-xs mt-1 text-gray-300">Instagram блокирует прямое воспроизведение</p>
        <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="text-xs mt-3 text-blue-300 hover:underline block bg-blue-900/30 py-2 px-3 rounded-md">
          Открыть в Instagram
        </a>
      </div>
    </div>
  `;
}