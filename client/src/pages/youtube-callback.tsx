import { useEffect, useState } from 'react';
import { useSearch } from 'wouter';

export default function YouTubeCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const search = useSearch();

  useEffect(() => {
    const urlParams = new URLSearchParams(search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const message = urlParams.get('message');
    const accessToken = urlParams.get('accessToken');
    const refreshToken = urlParams.get('refreshToken');
    const campaignId = urlParams.get('campaignId');

    if (error === 'true') {
      setStatus('error');
      setMessage(message ? decodeURIComponent(message) : 'Произошла ошибка авторизации');
      return;
    }

    if (success === 'true') {
      setStatus('success');
      setMessage(message ? decodeURIComponent(message) : 'YouTube успешно подключен!');
      
      // Если получили токены, сохраняем их в localStorage для передачи мастеру
      if (accessToken && refreshToken) {
        const tokenData = {
          accessToken,
          refreshToken,
          timestamp: Date.now()
        };
        
        // Добавляем campaignId если он есть в URL
        if (campaignId) {
          tokenData.campaignId = campaignId;
          console.log('🎯 [YouTube Callback] Campaign ID найден:', campaignId);
        } else {
          console.warn('⚠️ [YouTube Callback] Campaign ID не найден в URL параметрах');
        }
        
        localStorage.setItem('youtubeOAuthTokens', JSON.stringify(tokenData));
        console.log('🔑 [YouTube Callback] Токены сохранены в localStorage:', tokenData);
        
        // Если это popup окно, закрываем его через короткое время
        if (window.opener) {
          console.log('🪟 [YouTube Callback] Detected popup window, closing in 2 seconds...');
          setTimeout(() => {
            window.close();
          }, 2000);
        } else {
          // Если это обычное окно, переходим к настройкам кампании
          setTimeout(() => {
            if (campaignId) {
              window.location.href = `/campaigns/${campaignId}?openYouTube=true`;
            } else {
              window.location.href = '/';
            }
          }, 2000);
        }
      }
    } else {
      setStatus('error');
      setMessage('Неожиданная ошибка обработки авторизации');
      
      // Если это popup окно с ошибкой, закрываем его
      if (window.opener) {
        setTimeout(() => {
          window.close();
        }, 3000);
      }
      return;
    }
  }, [search]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Обработка авторизации...
            </h1>
            <p className="text-gray-600">
              Пожалуйста, подождите
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="rounded-full bg-green-100 p-3 mx-auto mb-4 w-16 h-16 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              YouTube подключен!
            </h1>
            <p className="text-gray-600 mb-4">
              {message}
            </p>
            <p className="text-sm text-gray-500">
              Окно автоматически закроется через несколько секунд...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="rounded-full bg-red-100 p-3 mx-auto mb-4 w-16 h-16 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Ошибка авторизации
            </h1>
            <p className="text-gray-600 mb-4">
              {message}
            </p>
            <button
              onClick={() => window.close()}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors"
            >
              Закрыть
            </button>
          </>
        )}
      </div>
    </div>
  );
}