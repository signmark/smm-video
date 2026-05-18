import { useEffect, useState } from 'react';
import { useSearch } from 'wouter';

export default function InstagramCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    console.log('🚀 Instagram OAuth Callback запущен');
    console.log('📋 Параметры URL:', { code: code?.substring(0, 20) + '...', state, error });

    if (error) {
      console.log('❌ Facebook OAuth ошибка:', error);
      setStatus('error');
      setMessage(`Ошибка Facebook: ${error}`);
      return;
    }

    if (!code || !state) {
      console.log('❌ Отсутствуют обязательные параметры');
      setStatus('error');
      setMessage('Отсутствует код авторизации или state параметр');
      return;
    }

    // Вызываем callback API
    processCallback(code, state);
  }, [search]);

  const processCallback = async (code: string, state: string) => {
    try {
      console.log('🔄 Отправляем callback запрос на сервер...');
      
      const response = await fetch(`/api/instagram/auth/callback?code=${code}&state=${state}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      console.log('📋 Ответ callback API:', data);

      if (response.ok && data.success) {
        console.log('✅ Instagram OAuth успешно завершен');
        console.log('📤 Отправляем новый токен в wizard через postMessage...');
        
        setStatus('success');
        setMessage('Instagram авторизация успешно завершена! Данные сохранены в кампании.');
        
        // Отправляем данные в родительское окно
        if (window.opener) {
          const oauthData = {
            type: 'INSTAGRAM_OAUTH_SUCCESS',
            data: {
              token: data.longLivedToken, // Новый токен из OAuth
              appId: data.appId, // App ID из верхнего уровня ответа
              instagramAccounts: data.instagramAccounts,
              user: data.user,
              success: true
            }
          };
          
          console.log('📤 Sending OAuth success data to parent window:', {
            type: oauthData.type,
            tokenPreview: data.longLivedToken?.substring(0, 20) + '...',
            appId: data.appId,
            accountsCount: data.instagramAccounts?.length || 0
          });
          
          window.opener.postMessage(oauthData, window.location.origin);
        }
        
        // Закрываем окно через 3 секунды
        setTimeout(() => {
          window.close();
        }, 3000);
      } else {
        console.log('❌ Ошибка callback API:', data.error);
        setStatus('error');
        setMessage(data.error || 'Неизвестная ошибка callback API');
      }
    } catch (error) {
      console.log('❌ Критическая ошибка callback:', error);
      setStatus('error');
      setMessage('Ошибка сети или сервера');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Обработка авторизации Instagram...
              </h2>
              <p className="text-gray-600">
                Пожалуйста, подождите пока мы сохраняем ваши данные авторизации.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="text-green-600 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Авторизация завершена!
              </h2>
              <p className="text-gray-600 mb-4">
                {message}
              </p>
              <p className="text-sm text-gray-500">
                Это окно автоматически закроется через несколько секунд...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-red-600 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Ошибка авторизации
              </h2>
              <p className="text-gray-600 mb-4">
                {message}
              </p>
              <button
                onClick={() => window.close()}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                Закрыть окно
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}