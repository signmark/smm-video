import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

export default function VkCallback() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState('Обработка авторизации ВКонтакте...');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const process = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.substring(1));

        const vkError = params.get('vk_error');
        if (vkError) {
          throw new Error(decodeURIComponent(vkError));
        }

        // --- VK ID OAuth2 v2 callback (server-side, saved to campaign) ---
        if (params.get('vk_oauth2') === 'success') {
          const campaignId = params.get('campaign_id');
          setStatus('Авторизация прошла успешно! Закрываем окно...');
          if (window.opener) {
            window.opener.postMessage({ type: 'VK_OAUTH2_SUCCESS', campaignId }, window.location.origin);
            setTimeout(() => window.close(), 800);
          } else {
            setTimeout(() => setLocation('/'), 1500);
          }
          return;
        }

        // --- Старый implicit flow (hash-based) ---
        const accessToken = hash.get('access_token') || params.get('vk_token');
        const userId = hash.get('user_id') || params.get('vk_user_id');

        if (accessToken) {
          setStatus('Токен получен, передаём в приложение...');
          if (window.opener) {
            window.opener.postMessage({
              type: 'VK_OAUTH_SUCCESS',
              data: { accessToken, userId, expiresIn: hash.get('expires_in') ? parseInt(hash.get('expires_in')!) : null }
            }, window.location.origin);
            setTimeout(() => window.close(), 800);
          } else {
            setTimeout(() => setLocation('/'), 1500);
          }
          return;
        }

        throw new Error('Не удалось получить токен. Повторите попытку.');
      } catch (error: any) {
        setIsError(true);
        setStatus(error.message);
        if (window.opener) {
          window.opener.postMessage({ type: 'VK_OAUTH_ERROR', error: error.message }, window.location.origin);
          setTimeout(() => window.close(), 2500);
        }
      }
    };

    process();
  }, [setLocation]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center max-w-md px-4">
        {!isError ? (
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4 text-red-500 text-2xl">✕</div>
        )}
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Авторизация ВКонтакте</h2>
        <p className={`text-sm ${isError ? 'text-red-600' : 'text-gray-600'}`}>{status}</p>
        {isError && !window.opener && (
          <button
            className="mt-4 text-blue-600 underline text-sm"
            onClick={() => window.history.back()}
          >
            Вернуться назад
          </button>
        )}
      </div>
    </div>
  );
}
