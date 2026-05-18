/**
 * YouTube OAuth Setup Component
 * Handles YouTube authentication flow for video publishing
 */

import React, { useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Youtube, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';

interface YouTubeOAuthSetupProps {
  onAuthComplete?: (authData: any) => void;
}

interface YouTubeAuthData {
  accessToken: string;
  refreshToken: string;
  channelId?: string;
  channelTitle?: string;
}

export function YouTubeOAuthSetup({ onAuthComplete }: YouTubeOAuthSetupProps) {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authData, setAuthData] = useState<YouTubeAuthData | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connected' | 'error'>('idle');
  const { toast } = useToast();
  const token = useAuthStore((state) => state.token);

  const startYouTubeAuth = async () => {
    try {
      setIsAuthenticating(true);
      
      const response = await axios.post('/api/youtube/auth/start', {}, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data.success && response.data.authUrl) {
        // Открываем окно авторизации
        const authWindow = window.open(
          response.data.authUrl,
          'youtube-auth',
          'width=600,height=700,scrollbars=yes,resizable=yes'
        );

        // Слушаем сообщения от окна авторизации
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          
          if (event.data.type === 'YOUTUBE_AUTH_SUCCESS') {
            setAuthData(event.data.tokens);
            setConnectionStatus('connected');
            authWindow?.close();
            window.removeEventListener('message', handleMessage);
            
            toast({
              title: 'YouTube подключен',
              description: 'Авторизация прошла успешно',
            });

            if (onAuthComplete) {
              onAuthComplete(event.data.tokens);
            }
          } else if (event.data.type === 'YOUTUBE_AUTH_ERROR') {
            setConnectionStatus('error');
            authWindow?.close();
            window.removeEventListener('message', handleMessage);
            
            toast({
              variant: 'destructive',
              title: 'Ошибка авторизации',
              description: event.data.error || 'Не удалось подключить YouTube',
            });
          }
        };

        window.addEventListener('message', handleMessage);

        // Проверяем, закрыто ли окно без завершения авторизации
        const checkClosed = setInterval(() => {
          if (authWindow?.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', handleMessage);
            setIsAuthenticating(false);
          }
        }, 1000);
        
      } else {
        throw new Error(response.data.error || 'Не удалось начать авторизацию');
      }
    } catch (error: any) {
      console.error('Ошибка при запуске YouTube авторизации:', error);
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: error.response?.data?.error || 'Не удалось начать авторизацию YouTube',
      });
      setConnectionStatus('error');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const testConnection = async () => {
    if (!authData) return;

    try {
      setIsTestingConnection(true);
      
      const response = await axios.post('/api/auth/youtube/test', {
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
        channelId: authData.channelId
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.data.success) {
        toast({
          title: 'Соединение работает',
          description: `Канал: ${response.data.channelInfo?.title}`,
        });
        setConnectionStatus('connected');
      }
    } catch (error: any) {
      console.error('Ошибка тестирования YouTube:', error);
      toast({
        variant: 'destructive',
        title: 'Ошибка соединения',
        description: error.response?.data?.error || 'Не удалось подключиться к YouTube',
      });
      setConnectionStatus('error');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const resetAuth = () => {
    setAuthData(null);
    setConnectionStatus('idle');
  };

  return (
    <div className="space-y-4">
      {connectionStatus === 'idle' && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Для публикации видео на YouTube требуется OAuth2 авторизация.
                Простого API ключа недостаточно для загрузки контента.
              </AlertDescription>
            </Alert>
            
            <Button
              onClick={startYouTubeAuth}
              disabled={isAuthenticating}
              className="w-full"
            >
              {isAuthenticating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Авторизация...
                </>
              ) : (
                <>
                  <Youtube className="w-4 h-4 mr-2" />
                  Подключить YouTube
                </>
              )}
            </Button>
        </div>
      )}

      {connectionStatus === 'connected' && authData && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="font-medium">YouTube подключен</span>
              <Badge variant="secondary">Активно</Badge>
            </div>

            <div className="space-y-2">
              <div className="text-sm">
                <strong>Access Token:</strong> {authData.accessToken.substring(0, 20)}...
              </div>
              <div className="text-sm">
                <strong>Refresh Token:</strong> {authData.refreshToken ? 'Доступен' : 'Отсутствует'}
              </div>
              {authData.channelId && (
                <div className="text-sm">
                  <strong>Channel ID:</strong> {authData.channelId}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={testConnection}
                disabled={isTestingConnection}
                size="sm"
              >
                {isTestingConnection ? (
                  <>
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                    Тестирование...
                  </>
                ) : (
                  'Тест соединения'
                )}
              </Button>
              
              <Button
                variant="outline"
                onClick={resetAuth}
                size="sm"
              >
                Переподключить
              </Button>
          </div>
        </div>
      )}

      {connectionStatus === 'error' && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Ошибка подключения к YouTube. Проверьте настройки OAuth или повторите авторизацию.
              </AlertDescription>
            </Alert>
            
            <Button
              variant="outline"
              onClick={resetAuth}
              className="w-full"
            >
              Повторить подключение
          </Button>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <div>• Для работы требуется настроенное OAuth2 приложение в Google Cloud Console</div>
        <div>• Необходимы переменные YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET</div>
        <div>• Поддерживается загрузка видео с обложками</div>
      </div>
    </div>
  );
}