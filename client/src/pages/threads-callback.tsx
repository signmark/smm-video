import { useEffect, useState } from 'react';
import { useSearch } from 'wouter';

export default function ThreadsCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const success = params.get('success');
    const error = params.get('error');
    const uname = params.get('username') || '';
    const threadsUserId = params.get('threadsUserId') || '';

    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }

    if (success === '1') {
      setStatus('success');
      setUsername(uname);
      setMessage(`Аккаунт @${uname} успешно подключён!`);

      if (window.opener) {
        window.opener.postMessage({
          type: 'THREADS_OAUTH_SUCCESS',
          data: { username: uname, threadsUserId }
        }, window.location.origin);
      }

      setTimeout(() => window.close(), 3000);
      return;
    }

    setStatus('error');
    setMessage('Неизвестный ответ от сервера');
  }, [search]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Подключаем Threads...</h2>
              <p className="text-gray-600">Пожалуйста, подождите.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="text-green-600 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Threads подключён!</h2>
              {username && (
                <p className="text-lg font-medium text-gray-800 mb-2">@{username}</p>
              )}
              <p className="text-gray-600 mb-4">{message}</p>
              <p className="text-sm text-gray-500">Окно закроется автоматически...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-red-600 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Ошибка авторизации</h2>
              <p className="text-gray-600 mb-4">{message}</p>
              <button
                onClick={() => window.close()}
                className="bg-black text-white px-4 py-2 rounded-md hover:bg-gray-800 transition-colors"
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
