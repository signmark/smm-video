import { useEffect, useState } from 'react';
import { useSearch, useLocation } from 'wouter';

export default function TikTokCallbackPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const search = useSearch();

  useEffect(() => {
    const urlParams = new URLSearchParams(search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const errorMessage = urlParams.get('message');
    const accountName = urlParams.get('accountName');
    const username = urlParams.get('username');
    const campaignId = urlParams.get('campaignId');

    if (error === 'true') {
      setStatus('error');
      setMessage(errorMessage ? decodeURIComponent(errorMessage) : 'Произошла ошибка авторизации');
      if (window.opener) {
        window.opener.postMessage(
          { type: 'TIKTOK_OAUTH_ERROR', error: errorMessage },
          window.location.origin
        );
        setTimeout(() => window.close(), 3000);
      }
      return;
    }

    if (success === 'true') {
      const name = accountName ? decodeURIComponent(accountName) : '';
      const user = username ? decodeURIComponent(username) : '';
      setStatus('success');
      setMessage(name ? `Аккаунт @${user || name} подключён!` : 'TikTok успешно подключён!');

      if (window.opener) {
        window.opener.postMessage(
          {
            type: 'TIKTOK_OAUTH_SUCCESS',
            data: { accountName: name, username: user, campaignId }
          },
          window.location.origin
        );
        setTimeout(() => window.close(), 2000);
      } else {
        setTimeout(() => {
          navigate(campaignId ? `/campaigns/${campaignId}` : '/');
        }, 2000);
      }
    } else {
      setStatus('error');
      setMessage('Неожиданная ошибка обработки авторизации');
      if (window.opener) {
        setTimeout(() => window.close(), 3000);
      }
    }
  }, [search]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Обработка авторизации...</h1>
            <p className="text-gray-500">Пожалуйста, подождите</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="rounded-full bg-green-100 p-3 mx-auto mb-4 w-16 h-16 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">TikTok подключён!</h1>
            <p className="text-gray-600 mb-4">{message}</p>
            <p className="text-sm text-gray-400">Окно закроется автоматически...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="rounded-full bg-red-100 p-3 mx-auto mb-4 w-16 h-16 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Ошибка авторизации</h1>
            <p className="text-gray-600 mb-4">{message}</p>
            <button
              onClick={() => window.close()}
              className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Закрыть
            </button>
          </>
        )}
      </div>
    </div>
  );
}
