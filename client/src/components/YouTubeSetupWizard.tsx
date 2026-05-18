import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Youtube, ExternalLink, CheckCircle, User, Users, Eye } from 'lucide-react';

interface YouTubeChannelInfo {
  channelId: string;
  channelTitle: string;
  channelDescription: string;
  thumbnails: any;
  subscriberCount: string;
  viewCount: string;
  videoCount: string;
  publishedAt: string;
}

interface YouTubeSetupWizardProps {
  campaignId: string;
  initialSettings?: any;
  onComplete: (data: { 
    channelId: string; 
    channelTitle: string;
    accessToken: string;
    refreshToken: string;
    channelInfo: YouTubeChannelInfo;
  }) => void;
}

export function YouTubeSetupWizard({ campaignId, initialSettings, onComplete }: YouTubeSetupWizardProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [channelInfo, setChannelInfo] = useState<YouTubeChannelInfo | null>(null);
  const [authTokens, setAuthTokens] = useState<{ accessToken: string; refreshToken: string } | null>(null);

  // Автоматическая загрузка существующих настроек при открытии мастера
  useEffect(() => {
    // Проверяем есть ли свежие токены из OAuth callback
    const oauthTokens = localStorage.getItem('youtubeOAuthTokens');
    let freshTokens = null;
    
    if (oauthTokens) {
      try {
        const tokens = JSON.parse(oauthTokens);
        // Токены считаются свежими в течение 5 минут
        if (Date.now() - tokens.timestamp < 5 * 60 * 1000) {
          freshTokens = tokens;
          console.log('🆕 [YouTube Wizard] Found fresh OAuth tokens from callback:', {
            hasCampaignId: !!tokens.campaignId,
            campaignId: tokens.campaignId || 'not specified'
          });
          localStorage.removeItem('youtubeOAuthTokens'); // Удаляем после использования
        }
      } catch (e) {
        console.error('❌ [YouTube Wizard] Error parsing OAuth tokens:', e);
        localStorage.removeItem('youtubeOAuthTokens');
      }
    }
    
    // Используем свежие токены или существующие настройки
    const tokensToUse = freshTokens || initialSettings?.youtube;
    
    if (tokensToUse?.accessToken) {
      console.log('🔄 [YouTube Wizard] Loading YouTube settings...', {
        source: freshTokens ? 'fresh OAuth' : 'existing settings',
        hasAccessToken: !!tokensToUse.accessToken,
        hasChannelId: !!tokensToUse.channelId
      });
      
      setAuthTokens({
        accessToken: tokensToUse.accessToken,
        refreshToken: tokensToUse.refreshToken || ''
      });
      
      // Если есть channelId в существующих настройках, пропускаем OAuth
      if (initialSettings?.youtube?.channelId && !freshTokens) {
        setStep(3);
        fetchChannelInfo(tokensToUse.accessToken);
      } else {
        // Если есть свежие токены или нет channelId, получаем информацию о канале
        setStep(2);
        fetchChannelInfo(tokensToUse.accessToken, {
          accessToken: tokensToUse.accessToken,
          refreshToken: tokensToUse.refreshToken || ''
        });
      }
    }
  }, [initialSettings]);

  const handleOAuthStart = async () => {
    setIsLoading(true);
    try {
      console.log('🚀 [YouTube Wizard] Starting OAuth process...');
      
      const response = await fetch(`/api/youtube/auth/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ campaignId })
      });
      
      if (!response.ok) {
        throw new Error(`OAuth start failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.authUrl) {
        console.log('✅ [YouTube Wizard] Opening OAuth popup window...');
        
        // Открываем popup окно для OAuth
        const popup = window.open(
          data.authUrl,
          'youtube-oauth',
          'width=600,height=700,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no'
        );
        
        if (!popup) {
          throw new Error('Popup window was blocked. Please allow popups for this site.');
        }
        
        // Ожидаем завершения OAuth в popup
        const checkClosed = setInterval(() => {
          try {
            // Пытаемся проверить статус popup окна
            if (popup.closed) {
              clearInterval(checkClosed);
              // Проверяем есть ли токены в localStorage
              const oauthTokens = localStorage.getItem('youtubeOAuthTokens');
              if (oauthTokens) {
                try {
                  const tokens = JSON.parse(oauthTokens);
                  console.log('🎉 [YouTube Wizard] OAuth completed successfully in popup');
                  
                  setAuthTokens({
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken
                  });
                  
                  // Получаем информацию о канале
                  fetchChannelInfo(tokens.accessToken, {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken
                  });
                  
                  // Очищаем токены из localStorage
                  localStorage.removeItem('youtubeOAuthTokens');
                  setIsLoading(false);
                } catch (e) {
                  console.error('❌ [YouTube Wizard] Error parsing OAuth tokens:', e);
                  setIsLoading(false);
                  toast({
                    title: "Ошибка",
                    description: "Не удалось обработать результат авторизации",
                    variant: "destructive"
                  });
                }
              } else {
                console.log('⚠️ [YouTube Wizard] OAuth popup closed without tokens');
                setIsLoading(false);
                toast({
                  title: "Авторизация отменена",
                  description: "OAuth окно закрыто без получения токенов",
                  variant: "destructive"
                });
              }
            }
          } catch (error) {
            // Cross-Origin-Opener-Policy ошибка - игнорируем и проверяем localStorage
            const oauthTokens = localStorage.getItem('youtubeOAuthTokens');
            if (oauthTokens) {
              clearInterval(checkClosed);
              try {
                const tokens = JSON.parse(oauthTokens);
                console.log('🎉 [YouTube Wizard] OAuth completed successfully in popup');
                
                setAuthTokens({
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken
                });
                
                // Получаем информацию о канале
                fetchChannelInfo(tokens.accessToken, {
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken
                });
                
                // Очищаем токены из localStorage
                localStorage.removeItem('youtubeOAuthTokens');
                setIsLoading(false);
              } catch (e) {
                console.error('❌ [YouTube Wizard] Error parsing OAuth tokens:', e);
                setIsLoading(false);
                toast({
                  title: "Ошибка",
                  description: "Не удалось обработать результат авторизации",
                  variant: "destructive"
                });
              }
            }
          }
        }, 1000);
        
        // Таймаут для popup (10 минут)
        setTimeout(() => {
          if (!popup.closed) {
            popup.close();
            clearInterval(checkClosed);
            setIsLoading(false);
            toast({
              title: "Таймаут авторизации",
              description: "OAuth процесс занял слишком много времени",
              variant: "destructive"
            });
          }
        }, 10 * 60 * 1000);
        
      } else {
        throw new Error(data.error || 'Failed to get authorization URL');
      }
    } catch (error: any) {
      console.error('❌ [YouTube Wizard] OAuth start error:', error);
      setIsLoading(false);
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось начать авторизацию",
        variant: "destructive"
      });
    }
  };

  const fetchChannelInfo = async (accessToken: string, tokens?: { accessToken: string; refreshToken: string }) => {
    try {
      const response = await fetch(`/api/youtube/channel-info?accessToken=${encodeURIComponent(accessToken)}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.errorCode === 'NO_CHANNEL') {
          throw new Error(errorData.error);
        }
        throw new Error(`Channel info request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.channelInfo) {
        console.log('✅ [YouTube Wizard] Channel info received:', data.channelInfo);
        setChannelInfo(data.channelInfo);
        setStep(3);
        
        toast({
          title: "Канал найден!",
          description: `Канал "${data.channelInfo.channelTitle}" готов к использованию`
        });
        
        // Автоматически завершаем настройку без требования нажать кнопку
        const tokensToUse = tokens || authTokens;
        console.log('🔍 [YouTube Wizard] Checking auto-completion conditions:', {
          hasTokens: !!tokensToUse,
          tokens: tokens ? 'passed as parameter' : 'from state',
          authTokens: !!authTokens,
          onComplete: typeof onComplete,
          campaignId: campaignId
        });
        
        if (tokensToUse) {
          // Используем campaignId из props
          const targetCampaignId = campaignId;
          
          console.log('✅ [YouTube Wizard] Auto-completing setup with data:', {
            channelId: data.channelInfo.channelId,
            channelTitle: data.channelInfo.channelTitle,
            accessToken: tokensToUse.accessToken ? 'present' : 'missing',
            refreshToken: tokensToUse.refreshToken ? 'present' : 'missing',
            targetCampaignId: targetCampaignId
          });
          
          try {
            onComplete({
              channelId: data.channelInfo.channelId,
              channelTitle: data.channelInfo.channelTitle,
              accessToken: tokensToUse.accessToken,
              refreshToken: tokensToUse.refreshToken,
              channelInfo: data.channelInfo
            });
            console.log('✅ [YouTube Wizard] onComplete called successfully for campaign:', targetCampaignId);
          } catch (error) {
            console.error('❌ [YouTube Wizard] Error calling onComplete:', error);
          }
        } else {
          console.warn('⚠️ [YouTube Wizard] No tokens available for auto-completion');
        }
      } else {
        throw new Error(data.error || 'Failed to get channel info');
      }
    } catch (error: any) {
      console.error('❌ [YouTube Wizard] Channel info error:', error);
      
      // Проверяем тип ошибки
      if (error.message?.includes('У вас нет YouTube канала')) {
        console.log('🔄 [YouTube Wizard] No channel found - showing channel creation step');
        setStep(5); // Переходим к шагу создания канала
      } else if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        console.log('🔄 [YouTube Wizard] Authorization error detected, returning to step 1');
        setStep(1); // Возвращаемся к начальному шагу для повторной авторизации
        setAuthTokens({ accessToken: '', refreshToken: '' }); // Сбрасываем токены
      }
      
      // Показываем toast только для неожиданных ошибок, не для отсутствия канала
      if (!error.message?.includes('У вас нет YouTube канала')) {
        toast({
          title: "Ошибка получения данных канала",
          description: error.message || "Не удалось получить информацию о канале",
          variant: "destructive"
        });
      }
    }
  };

  const handleComplete = () => {
    if (channelInfo && authTokens) {
      console.log('✅ [YouTube Wizard] Completing setup with data:', {
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.channelTitle
      });
      
      onComplete({
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.channelTitle,
        accessToken: authTokens.accessToken,
        refreshToken: authTokens.refreshToken,
        channelInfo
      });
      
      toast({
        title: "YouTube настроен!",
        description: `Канал "${channelInfo.channelTitle}" готов к публикации видео`
      });
    }
  };

  const formatNumber = (num: string) => {
    const number = parseInt(num);
    if (number >= 1000000) {
      return `${(number / 1000000).toFixed(1)}M`;
    } else if (number >= 1000) {
      return `${(number / 1000).toFixed(1)}K`;
    }
    return number.toString();
  };

  return (
    <div className="space-y-6">
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="h-6 w-6 text-red-600" />
              Настройка YouTube
            </CardTitle>
            <CardDescription>
              Подключите ваш YouTube канал для автоматической публикации видео.
              Используется системный API ключ - вам нужна только авторизация.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Что произойдет:</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Откроется окно авторизации YouTube</li>
                <li>• Автоматически получится ID вашего канала</li>
                <li>• Система будет готова к публикации видео</li>
                <li>• API ключ уже настроен системой</li>
              </ul>
            </div>
            
            <Button 
              onClick={handleOAuthStart} 
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Авторизация...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Авторизоваться в YouTube
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              Получение информации о канале
            </CardTitle>
            <CardDescription>
              Авторизация прошла успешно. Получаю данные вашего YouTube канала...
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-6 w-6 text-orange-600" />
              Требуется повторная авторизация
            </CardTitle>
            <CardDescription>
              Токен авторизации истек или недействителен. Необходимо авторизоваться заново.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-orange-50 p-4 rounded-lg">
              <h4 className="font-medium text-orange-900 mb-2">Что произошло:</h4>
              <ul className="text-sm text-orange-800 space-y-1">
                <li>• Токен доступа YouTube истек</li>
                <li>• Или были изменены настройки канала</li>
                <li>• Требуется новая авторизация для получения свежих токенов</li>
              </ul>
            </div>
            
            <Button 
              onClick={() => {
                setStep(1);
                setAuthTokens(null);
                setChannelInfo(null);
              }}
              className="w-full"
              size="lg"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Авторизоваться заново
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="h-6 w-6 text-orange-600" />
              Нужно создать YouTube канал
            </CardTitle>
            <CardDescription>
              Авторизация прошла успешно, но у вашего Google аккаунта нет YouTube канала
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 p-4 rounded-lg">
              <h4 className="font-semibold text-orange-900 mb-3">📋 Пошаговая инструкция:</h4>
              <ol className="text-sm text-orange-800 space-y-3 list-decimal list-inside">
                <li className="flex items-start gap-2">
                  <span className="font-medium">1.</span>
                  <div>
                    Откройте <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium hover:text-blue-800">studio.youtube.com</a> в новой вкладке
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium">2.</span>
                  <div>Войдите в тот же Google аккаунт, который авторизовали</div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium">3.</span>
                  <div>Нажмите "Создать канал" и следуйте инструкциям</div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium">4.</span>
                  <div>Вернитесь сюда и нажмите "Проверить канал"</div>
                </li>
              </ol>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">💡 Альтернативный способ:</h4>
              <p className="text-sm text-blue-800">
                Перейдите на <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium hover:text-blue-800">youtube.com</a> → 
                нажмите на аватар справа вверху → "Создать канал"
              </p>
            </div>
            
            <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg">
              <h4 className="font-medium text-gray-700 mb-2">🔗 Полезные ссылки:</h4>
              <div className="flex flex-wrap gap-3 text-sm">
                <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
                  YouTube Studio
                </a>
                <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
                  YouTube.com
                </a>
                <a href="https://support.google.com/youtube/answer/1646861" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
                  Справка по созданию канала
                </a>
              </div>
            </div>
            
            <div className="flex flex-col gap-3 pt-2">
              <Button 
                onClick={() => {
                  window.open('https://studio.youtube.com', '_blank');
                }}
                className="w-full bg-red-600 hover:bg-red-700"
                size="lg"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Открыть YouTube Studio
              </Button>
              
              <div className="flex gap-3">
                <Button 
                  onClick={() => {
                    // Повторяем запрос с теми же токенами
                    if (authTokens?.accessToken) {
                      fetchChannelInfo(authTokens.accessToken, authTokens);
                    }
                  }}
                  variant="outline"
                  className="flex-1"
                  disabled={!authTokens?.accessToken}
                >
                  <Youtube className="h-4 w-4 mr-2" />
                  Проверить канал
                </Button>
                <Button 
                  onClick={() => {
                    setStep(1);
                    setAuthTokens({ accessToken: '', refreshToken: '' });
                    setChannelInfo(null);
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  Начать заново
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && channelInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              YouTube канал готов!
            </CardTitle>
            <CardDescription>
              Ваш канал успешно подключен и готов к публикации видео
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-4 p-4 bg-green-50 rounded-lg">
              {channelInfo.thumbnails?.default?.url && (
                <img 
                  src={channelInfo.thumbnails.default.url} 
                  alt="Channel Avatar"
                  className="w-16 h-16 rounded-full"
                />
              )}
              <div className="flex-1">
                <h4 className="font-semibold text-lg">{channelInfo.channelTitle}</h4>
                <p className="text-sm text-gray-600 mb-2">
                  ID: {channelInfo.channelId}
                </p>
                <div className="flex gap-4 text-sm">
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {formatNumber(channelInfo.subscriberCount)} подписчиков
                  </Badge>
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {formatNumber(channelInfo.viewCount)} просмотров
                  </Badge>
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Youtube className="h-3 w-3" />
                    {channelInfo.videoCount} видео
                  </Badge>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button onClick={handleComplete} className="flex-1" size="lg">
                <CheckCircle className="h-4 w-4 mr-2" />
                Завершить настройку
              </Button>
              <Button 
                onClick={() => {
                  setStep(1);
                  setAuthTokens(null);
                  setChannelInfo(null);
                }} 
                variant="outline" 
                size="lg"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Авторизоваться заново
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}