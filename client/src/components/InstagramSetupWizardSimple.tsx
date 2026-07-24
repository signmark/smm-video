import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, ExternalLink, Loader2, Instagram, ArrowRight, Search, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface InstagramSetupWizardProps {
  campaignId: string;
  onComplete: (data?: {
    token: string;
    accessToken: string;
    businessAccountId: string;
    appId: string;
    appSecret: string;
    needsReload?: boolean;
  }) => void;
  onCancel: () => void;
  onSettingsRefresh?: () => void;
}

const InstagramSetupWizardSimple: React.FC<InstagramSetupWizardProps> = ({ campaignId, onComplete, onCancel, onSettingsRefresh }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAccountSelection, setShowAccountSelection] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState<Array<{
    id: string;
    name: string;
    username?: string;
  }>>([]);
  const [formData, setFormData] = useState<{
    appId: string;
    appSecret: string;
    accessToken: string;
    businessAccountId: string;
    configured?: boolean;
  }>({
    appId: '',
    appSecret: '',
    accessToken: '',
    businessAccountId: ''
  });
  const [error, setError] = useState<string | null>(null);
  
  const { toast } = useToast();

  // Добавляем консольный лог для диагностики
  console.log('Instagram Setup Wizard rendering with campaignId:', campaignId);

  // Обработчик сообщений от OAuth окна
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      // Проверяем источник сообщения
      if (event.origin !== window.location.origin) {
        console.log('📤 Instagram OAuth - Origin mismatch, ignoring message');
        return;
      }

      if (event.data.type === 'INSTAGRAM_OAUTH_SUCCESS') {
        console.log('✅ Instagram OAuth success message received!');
        
        // Не ищем токен — просто помечаем как настроенный и перезагружаем
        setFormData(prev => ({ ...prev, configured: true }));
        
        toast({
          title: "Instagram подключен",
          description: "Ищем доступные аккаунты..."
        });
        
        // Перезагружаем настройки с сервера
        onSettingsRefresh?.();
        
        // Автоматически ищем аккаунты (токен уже в Directus, не нужен в браузере)
        setTimeout(() => {
          console.log('🔍 Auto-discovering Instagram accounts after OAuth...');
          handleDiscoverAccounts();
        }, 1000);
      }
    };

    // Добавляем слушатель сообщений
    window.addEventListener('message', handleOAuthMessage);
    
    // Убираем слушатель при размонтировании
    return () => {
      window.removeEventListener('message', handleOAuthMessage);
    };
  }, [toast, onSettingsRefresh]);

  // Слушатель localStorage как backup (переживает cross-origin opener loss)
  useEffect(() => {
    const checkStorage = () => {
      const raw = localStorage.getItem('instagram_oauth_result');
      if (raw) {
        try {
          const data = JSON.parse(raw);
          if (data.success) {
            localStorage.removeItem('instagram_oauth_result');
            localStorage.removeItem('instagram_oauth_timestamp');
            setFormData(prev => ({ ...prev, configured: true }));
            toast({
              title: "Instagram подключен",
              description: "Ищем доступные аккаунты..."
            });
            onSettingsRefresh?.();
            // Автоматически ищем аккаунты
            setTimeout(() => {
              console.log('🔍 Auto-discovering Instagram accounts after OAuth (localStorage)...');
              handleDiscoverAccounts();
            }, 1000);
          }
        } catch (e) {
          localStorage.removeItem('instagram_oauth_result');
        }
      }
    };
    
    // Проверяем при монтировании
    checkStorage();
    
    // Слушаем изменения storage (из других tab/окон)
    window.addEventListener('storage', checkStorage);
    return () => window.removeEventListener('storage', checkStorage);
  }, [toast, onSettingsRefresh]);

  // Загружаем существующие данные из кампании и проверяем Facebook
  useEffect(() => {
    const loadExistingSettings = async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/instagram-settings`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.settings) {
            const settings = data.settings;
            const accessToken = settings.accessToken || settings.longLivedToken || settings.token || '';
            
            setFormData({
              appId: settings.appId || '',
              appSecret: settings.appSecret || '',
              accessToken: accessToken,
              businessAccountId: settings.businessAccountId || settings.instagramId || '',
              // Токены вырезаны сервером — «настроено» определяем по серверному флагу
              // и несекретным полям (businessAccountId / список найденных аккаунтов)
              configured: !!(settings.configured || settings.businessAccountId || settings.instagramId || settings.instagramAccounts?.length)
            });

            // Если есть токен - автоматически проверяем Facebook страницы
            if (accessToken) {
              console.log('🔍 Auto-checking Facebook pages for existing Instagram token...');
              try {
                const facebookResponse = await fetch('/api/facebook/pages', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ token: accessToken }),
                });

                if (facebookResponse.ok) {
                  const facebookData = await facebookResponse.json();
                  console.log('🔍 Facebook pages found during loading:', facebookData);
                  
                  // Если найдена ровно одна Facebook страница - автоматически настраиваем её
                  if (facebookData.success && facebookData.pages && facebookData.pages.length === 1) {
                    const page = facebookData.pages[0];
                    console.log('🔧 Auto-configuring Facebook page during Instagram load:', page);
                    
                    // Проверяем что Facebook ещё не настроен
                    const currentFbResponse = await fetch(`/api/campaigns/${campaignId}/facebook-settings`, {
                      headers: {
                        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                      }
                    });

                    const currentFbData = await currentFbResponse.json();
                    const hasExistingFb = currentFbData.success && currentFbData.settings && currentFbData.settings.pageId;

                    if (!hasExistingFb) {
                      // Сохраняем Facebook настройки автоматически
                      const saveFacebookResponse = await fetch(`/api/campaigns/${campaignId}`, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                        },
                        body: JSON.stringify({
                          social_media_settings: {
                            facebook: {
                              token: accessToken,
                              pageId: page.id,
                              pageName: page.name,
                              autoConfiguredAt: new Date().toISOString()
                            }
                          }
                        })
                      });

                      if (saveFacebookResponse.ok) {
                        toast({
                          title: "Facebook настроен автоматически",
                          description: `Настроена страница: ${page.name}`,
                          variant: "default"
                        });
                        console.log('✅ Facebook page auto-configured during Instagram load');
                      }
                    }
                  }
                }
              } catch (fbError) {
                console.error('Error auto-checking Facebook pages:', fbError);
                // Не показываем ошибку пользователю
              }
            }
          }
        }
      } catch (error) {
        console.error('Error loading Instagram settings:', error);
      }
    };

    loadExistingSettings();
  }, [campaignId]);

  // Функция копирования в буфер обмена
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Скопировано!",
      description: "URL скопирован в буфер обмена"
    });
  };

  // Функция для загрузки доступных Instagram аккаунтов и автоматической настройки Facebook
  const handleDiscoverAccounts = async () => {
    setIsProcessing(true);
    try {
      // Токены не приходят в браузер (sanitizeOAuthSecrets) — если пользователь
      // не ввёл токен вручную, сервер сам возьмёт сохранённый OAuth-токен из базы.
      const instagramResponse = await fetch(`/api/campaigns/${campaignId}/discover-instagram-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(
          formData.accessToken ? { accessToken: formData.accessToken } : {}
        )
      });

      const instagramData = await instagramResponse.json();
      console.log('🔍 Instagram API response data:', instagramData);
      console.log('🔍 Instagram response success:', instagramData.success);
      console.log('🔍 Instagram accounts found:', instagramData.accounts?.length || 0);
      
      if (instagramData.success && instagramData.accounts && instagramData.accounts.length > 0) {
        console.log('✅ Instagram accounts successfully discovered:', instagramData.accounts);
        setAvailableAccounts(instagramData.accounts);
        setShowAccountSelection(true);
        
        // 2. Параллельно проверяем Facebook страницы тем же токеном
        // (только если токен введён вручную — из базы он в браузер не приходит)
        if (formData.accessToken) {
        try {
          console.log('🔍 Checking Facebook pages with Instagram token...');
          const facebookResponse = await fetch('/api/facebook/pages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: formData.accessToken }),
          });

          if (facebookResponse.ok) {
            const facebookData = await facebookResponse.json();
            console.log('🔍 Facebook pages found:', facebookData);
            
            // 3. Если найдена ровно одна Facebook страница - автоматически настраиваем её
            if (facebookData.success && facebookData.pages && facebookData.pages.length === 1) {
              const page = facebookData.pages[0];
              console.log('🔧 Auto-configuring single Facebook page:', page);
              
              // Сохраняем Facebook настройки автоматически
              const saveFacebookResponse = await fetch(`/api/campaigns/${campaignId}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({
                  social_media_settings: {
                    facebook: {
                      token: formData.accessToken,
                      pageId: page.id,
                      pageName: page.name,
                      autoConfiguredAt: new Date().toISOString()
                    }
                  }
                })
              });

              if (saveFacebookResponse.ok) {
                toast({
                  title: "Facebook настроен автоматически",
                  description: `Настроена страница: ${page.name}`,
                  variant: "default"
                });
                console.log('✅ Facebook page auto-configured successfully');
              }
            } else if (facebookData.pages && facebookData.pages.length > 1) {
              toast({
                title: "Facebook страницы найдены",
                description: `Найдено ${facebookData.pages.length} страниц. Настройте вручную в разделе Facebook.`,
                variant: "default"
              });
            }
          }
        } catch (fbError) {
          console.error('Error checking Facebook pages:', fbError);
          // Не показываем ошибку пользователю, так как это дополнительная функция
        }
        }

        toast({
          title: "Instagram аккаунты найдены",
          description: `Найдено ${instagramData.accounts.length} Instagram Business аккаунтов`
        });
      } else {
        throw new Error(instagramData.error || 'Instagram аккаунты не найдены');
      }
    } catch (error: any) {
      console.error('Error discovering Instagram accounts:', error);
      
      // Проверяем специальные типы ошибок
      let errorMessage = error.message;
      let shouldShowReauth = false;
      
      if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
        errorMessage = 'Ошибка сервера при поиске Instagram аккаунтов';
      } else if (error.message.includes('401') || error.message.includes('TOKEN_EXPIRED')) {
        errorMessage = 'Токен Instagram/Facebook истек. Необходима переавторизация.';
        shouldShowReauth = true;
      } else if (error.message.includes('403')) {
        errorMessage = 'Нет доступа к Instagram API. Проверьте права доступа.';
      }
      
      toast({
        title: shouldShowReauth ? "Требуется переавторизация" : "Ошибка",
        description: errorMessage + (shouldShowReauth ? " Нажмите кнопку OAuth для новой авторизации." : ""),
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Функция выбора Instagram аккаунта
  const handleSelectAccount = async (accountId: string, accountName: string) => {
    console.log('🔍 Selecting Instagram account:', { accountId, accountName });
    setFormData(prev => {
      const newData = { ...prev, businessAccountId: accountId };
      console.log('🔍 Updated formData:', newData);
      return newData;
    });
    setShowAccountSelection(false);
    
    // Сразу сохраняем выбранный аккаунт в базу данных
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          social_media_settings: {
            instagram: {
              appId: formData.appId,
              appSecret: formData.appSecret,
              accessToken: formData.accessToken,
              businessAccountId: accountId, // Используем новый ID
              longLivedToken: formData.accessToken,
              setupCompletedAt: new Date().toISOString()
            }
          }
        })
      });

      if (response.ok) {
        toast({
          title: "Аккаунт выбран",
          description: `Выбран аккаунт: ${accountName} (ID: ${accountId})`
        });
        
        // Уведомляем родительский компонент об изменениях с данными
        if (onComplete) {
          onComplete({
            token: formData.accessToken,
            accessToken: formData.accessToken,
            businessAccountId: accountId,
            appId: formData.appId,
            appSecret: formData.appSecret,
            needsReload: true
          });
        }
        
        // Дополнительно отправляем событие для обновления формы
        window.dispatchEvent(new CustomEvent('instagram-settings-updated', {
          detail: {
            token: formData.accessToken,
            accessToken: formData.accessToken,
            businessAccountId: accountId,
            appId: formData.appId,
            appSecret: formData.appSecret
          }
        }));
      }
    } catch (error) {
      console.error('Error saving selected account:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить выбранный аккаунт",
        variant: "destructive"
      });
    }
  };

  const handleGetToken = async () => {
    if (!formData.appId || !formData.appSecret) {
      toast({
        title: "Ошибка",
        description: "Введите App ID и App Secret",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch(`/api/instagram/auth/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          appId: formData.appId,
          appSecret: formData.appSecret,
          redirectUri: `${window.location.origin}/instagram-callback`,
          campaignId: campaignId
        })
      });

      const data = await response.json();
      
      if (data.success && data.authUrl) {
        // Открываем окно авторизации точно как VK
        window.open(data.authUrl, 'instagram-auth', 'width=600,height=600');
        
        toast({
          title: "Авторизация Instagram",
          description: "Скопируйте полученный токен в поле ниже, затем выберите аккаунт"
        });
      } else {
        throw new Error(data.error || 'Ошибка создания ссылки авторизации');
      }
    } catch (error: any) {
      console.error('Error starting Instagram OAuth:', error);
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!formData.accessToken || !formData.businessAccountId) {
      toast({
        title: "Ошибка",
        description: "Введите Access Token и Business Account ID",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          social_media_settings: {
            instagram: {
              appId: formData.appId,
              appSecret: formData.appSecret,
              accessToken: formData.accessToken,
              businessAccountId: formData.businessAccountId,
              longLivedToken: formData.accessToken,
              setupCompletedAt: new Date().toISOString()
            }
          }
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        toast({
          title: "Успех",
          description: "Instagram настроен успешно!",
          variant: "default"
        });
        setTimeout(() => {
          onComplete({
            token: formData.accessToken,
            accessToken: formData.accessToken,
            businessAccountId: formData.businessAccountId,
            appId: formData.appId,
            appSecret: formData.appSecret,
            needsReload: true
          });
        }, 1500);
      } else {
        throw new Error(data.error || 'Ошибка сохранения настроек');
      }
    } catch (error: any) {
      console.error('Error saving Instagram settings:', error);
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Обработка ошибок рендеринга
  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Alert>
          <AlertDescription>
            Ошибка загрузки мастера настройки Instagram: {error}
          </AlertDescription>
        </Alert>
        <Button onClick={onCancel} className="mt-4">
          Закрыть
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-base font-semibold">Настройка Instagram API</h3>
          <p className="text-sm text-gray-600">Пошаговая настройка для публикации контента</p>
          {/* Debug info */}
          <p className="text-xs text-gray-400 mt-1">
            Debug: businessAccountId = {formData.businessAccountId || 'не выбран'}
          </p>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700"
        >
          ✕
        </Button>
      </div>
      
      <Alert className="py-3 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <AlertDescription>
          <div className="mb-3 pb-3 border-b border-blue-200 dark:border-blue-700">
            <a 
              href="https://smm.omemo.tech/help/tutorials/fb1480e7-68ae-462e-9d47-cf5ec1d0f72e" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-medium"
            >
              📹 Видео-инструкция по настройке <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>
              <strong>Создайте бизнес-портфолио и бизнес-страницу в Facebook Business Manager</strong>
              <div className="mt-1 ml-5 text-xs">
                <a 
                  href="https://business.facebook.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  Открыть Business Manager <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </li>
            <li><strong>Создайте или привяжите бизнес страницу к бизнес-портфолио</strong></li>
            <li><strong>Привяжите Instagram аккаунт к бизнес странице</strong></li>
            <li><strong>Убедитесь, что ваш Instagram-аккаунт связан с бизнес-портфолио</strong> и выполнен вход в разделе Аккаунты Instagram</li>
            <li><strong>Создайте приложение в Facebook Developer</strong></li>
            <li>
              <strong>Добавьте callback URLs</strong> в настройках <strong>Facebook Login → Settings</strong>:
              <div className="mt-2 ml-5 space-y-1.5">
                <div className="bg-white dark:bg-gray-800 p-2 rounded flex items-center justify-between gap-2">
                  <code className="text-xs break-all">https://smm.omemo.tech/facebook-callback</code>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => copyToClipboard('https://smm.omemo.tech/facebook-callback')}
                    className="h-6 w-6 p-0 shrink-0"
                    data-testid="button-copy-facebook-callback"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="bg-white dark:bg-gray-800 p-2 rounded flex items-center justify-between gap-2">
                  <code className="text-xs break-all">https://smm.omemo.tech/instagram-callback</code>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => copyToClipboard('https://smm.omemo.tech/instagram-callback')}
                    className="h-6 w-6 p-0 shrink-0"
                    data-testid="button-copy-instagram-callback"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
            <li className="mt-2">
              <strong>Добавьте необходимые права для приложения</strong>
              <div className="mt-1 ml-5 text-xs text-muted-foreground">
                Включите следующие разрешения:
                <div className="grid grid-cols-2 gap-x-4 mt-1 font-mono">
                  <div>✓ ads_management</div>
                  <div>✓ instagram_basic</div>
                  <div>✓ instagram_manage_insights</div>
                  <div>✓ instagram_content_publish</div>
                  <div>✓ pages_read_engagement</div>
                  <div>✓ pages_manage_posts</div>
                </div>
              </div>
            </li>
            <li className="mt-2"><strong>Введите App ID и App Secret</strong> из Facebook приложения</li>
            <li><strong>Нажмите "Получить токен Instagram"</strong> для авторизации</li>
            <li><strong>Скопируйте полученный токен</strong> в поле "Access Token"</li>
            <li><strong>Выберите Instagram Business аккаунт</strong> из списка</li>
            <li><strong>Сохраните настройки</strong></li>
          </ol>
        </AlertDescription>
      </Alert>
        
      <Card>
        <CardContent className="pt-4 space-y-3">
            {/* App ID и App Secret */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="appId">App ID *</Label>
                <Input
                  id="appId"
                  type="text"
                  value={formData.appId}
                  onChange={(e) => setFormData(prev => ({ ...prev, appId: e.target.value }))}
                  placeholder="Введите App ID"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appSecret">App Secret *</Label>
                <Input
                  id="appSecret"
                  type="password"
                  value={formData.appSecret}
                  onChange={(e) => setFormData(prev => ({ ...prev, appSecret: e.target.value }))}
                  placeholder="Введите App Secret"
                  required
                />
              </div>
            </div>

            {/* Кнопка получения токена */}
            <Button 
              onClick={handleGetToken}
              disabled={isProcessing || !formData.appId || !formData.appSecret}
              className="w-full"
              variant="outline"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Получение токена...
                </>
              ) : (
                <>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Получить токен Instagram
                </>
              )}
            </Button>

            {/* Access Token */}
            <div className="space-y-2">
              <Label htmlFor="accessToken">Access Token *</Label>
              <Input
                id="accessToken"
                type="text"
                value={formData.accessToken}
                onChange={(e) => setFormData(prev => ({ ...prev, accessToken: e.target.value }))}
                placeholder="Вставьте полученный токен"
                required
              />
            </div>

            {/* Кнопка поиска аккаунтов — показываем если настроено (есть токен в DB) но аккаунты ещё не выбраны */}
            {formData.configured && !showAccountSelection && !formData.businessAccountId && (
              <Button 
                onClick={handleDiscoverAccounts}
                disabled={isProcessing}
                className="w-full"
                variant="outline"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Поиск аккаунтов...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Найти Instagram аккаунты
                  </>
                )}
              </Button>
            )}

            {/* Список доступных аккаунтов */}
            {showAccountSelection && availableAccounts.length > 0 && (
              <div className="space-y-3">
                <Label>Выберите Instagram Business аккаунт:</Label>
                <div className="space-y-2">
                  {availableAccounts.map((account) => (
                    <Card key={account.id} className="cursor-pointer hover:bg-gray-50 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <h4 className="font-semibold">{account.name}</h4>
                            {account.username && (
                              <p className="text-sm text-gray-600">@{account.username}</p>
                            )}
                            <Badge variant="outline" className="mt-1">
                              ID: {account.id}
                            </Badge>
                          </div>
                          <Button 
                            onClick={() => handleSelectAccount(account.id, account.name)}
                            disabled={isProcessing}
                            size="sm"
                          >
                            <>
                              Выбрать
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Business Account ID — показываем если аккаунт выбран */}
            {formData.businessAccountId && (
              <div className="space-y-2">
                <Label htmlFor="businessAccountId">Выбранный Instagram аккаунт</Label>
                <Input
                  id="businessAccountId"
                  type="text"
                  value={formData.businessAccountId || ''}
                  readOnly
                />
                <p className="text-xs text-green-600">✓ Аккаунт выбран для публикации</p>
              </div>
            )}
          </CardContent>
        </Card>
      
      {/* Кнопки управления */}
      <div className="mt-6 flex justify-between">
        <Button 
          variant="outline" 
          onClick={() => {
            console.log('Instagram wizard: Отмена нажата');
            if (onCancel) {
              onCancel();
            }
          }}
          disabled={isProcessing}
        >
          Отмена
        </Button>
        
        <Button 
          onClick={handleSaveSettings}
          disabled={isProcessing || !formData.accessToken || !formData.businessAccountId}
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Сохранение...
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Сохранить настройки
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default InstagramSetupWizardSimple;
