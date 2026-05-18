import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  AlertTriangle,
  ExternalLink, 
  Facebook, 
  Instagram, 
  Settings, 
  Copy,
  ChevronRight,
  User,
  Key,
  Link as LinkIcon,
  Users
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import FacebookGroupsSelector from './FacebookGroupsSelector';

interface InstagramSetupWizardProps {
  campaignId: string;
  instagramSettings?: {
    appId?: string;
    appSecret?: string;
    instagramId?: string;
    accessToken?: string;
  };
  onSettingsUpdate?: (settings: any) => void;
}

const InstagramSetupWizardComplete: React.FC<InstagramSetupWizardProps> = ({ 
  campaignId, 
  instagramSettings = {}, 
  onSettingsUpdate 
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    appId: instagramSettings.appId || '',
    appSecret: instagramSettings.appSecret || '',
    instagramId: instagramSettings.instagramId || '',
    accessToken: instagramSettings.accessToken || ''
  });
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [facebookToken, setFacebookToken] = useState('');
  const [instagramAccounts, setInstagramAccounts] = useState<any[]>([]);
  
  const { toast } = useToast();

  // Webhook URL для N8N колбека
  const webhookUrl = process.env.N8N_URL ? `${process.env.N8N_URL}/webhook/instagram-auth` : 'https://n8n.omemo.tech/webhook/instagram-auth';
  const redirectUri = `${window.location.origin}/instagram-callback`;

  useEffect(() => {
    if (instagramSettings) {
      setFormData({
        appId: instagramSettings.appId || '',
        appSecret: instagramSettings.appSecret || '',
        instagramId: instagramSettings.instagramId || '',
        accessToken: instagramSettings.accessToken || ''
      });
      
      // Если уже есть настройки, переходим к шагу 4
      if (instagramSettings.appId && instagramSettings.appSecret) {
        setCurrentStep(4);
      }
    }
  }, [instagramSettings]);



  // Слушатель сообщений из OAuth callback окна
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log('📡 WIZARD - Message received from callback:', event.data);
      
      if (event.origin !== window.location.origin) {
        console.log('❌ WIZARD - Origin mismatch, ignoring message');
        return;
      }

      if (event.data.type === 'INSTAGRAM_OAUTH_SUCCESS') {
        console.log('✅ WIZARD - OAuth success message received!');
        console.log('📋 WIZARD - OAuth data:', event.data.data);
        
        // Обновляем локальное состояние с полученным токеном
        if (event.data.data.token) {
          console.log('🔑 WIZARD - Updating accessToken in form:', event.data.data.token.substring(0, 20) + '...');
          setFormData(prev => ({
            ...prev,
            accessToken: event.data.data.token
          }));
          
          // Сохраняем токен для Facebook групп и переходим к шагу 5
          setFacebookToken(event.data.data.token);
          setCurrentStep(5);
        }
        
        // Обновляем настройки через callback
        if (onSettingsUpdate && event.data.data) {
          console.log('🔄 WIZARD - Calling onSettingsUpdate callback');
          onSettingsUpdate({
            ...event.data.data,
            needsReload: true // Флаг для перезагрузки настроек
          });
        }
        
        toast({
          title: "Instagram авторизован!",
          description: "Токен получен и сохранен в настройки кампании"
        });
        
        console.log('✅ WIZARD - OAuth processing complete, stopping loading state');
        setOauthLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSettingsUpdate, toast]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Скопировано!",
      description: "Текст скопирован в буфер обмена"
    });
  };

  const startOAuthFlow = async () => {
    if (!formData.appId || !formData.appSecret) {
      toast({
        title: "Ошибка",
        description: "Введите App ID и App Secret"
      });
      return;
    }

    setOauthLoading(true);
    
    try {
      // Используем код из прикрепленного файла для создания OAuth URL
      const response = await fetch('/api/instagram/auth/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId: formData.appId,
          appSecret: formData.appSecret,
          redirectUri: redirectUri,
          webhookUrl: webhookUrl,
          instagramId: formData.instagramId,
          campaignId: campaignId
        })
      });

      const data = await response.json();
      
      if (data.authUrl) {
        setAuthUrl(data.authUrl);
        // Открываем OAuth окно
        window.open(data.authUrl, 'instagram-auth', 'width=600,height=700');
        
        toast({
          title: "OAuth авторизация",
          description: "Откроется окно для авторизации Instagram"
        });
      } else {
        throw new Error(data.error || 'Не удалось создать URL авторизации');
      }
    } catch (error) {
      console.error('OAuth error:', error);
      toast({
        title: "Ошибка OAuth",
        description: error instanceof Error ? error.message : "Произошла ошибка"
      });
    } finally {
      setOauthLoading(false);
    }
  };

  const findAllInstagramAccounts = async () => {
    if (!formData.accessToken) {
      toast({
        title: "Ошибка",
        description: "Access Token обязателен для поиска аккаунтов"
      });
      return;
    }

    setOauthLoading(true);
    
    try {
      console.log('🔍 [WIZARD] Ищем Instagram аккаунты с токеном:', formData.accessToken.substring(0, 20) + '...');
      
      const response = await apiRequest(`/api/campaigns/${campaignId}/discover-instagram-accounts`, {
        method: 'POST',
        data: {
          accessToken: formData.accessToken
        }
      });

      console.log('🔍 [WIZARD] Ответ сервера:', response);

      if (response.success && response.accounts && response.accounts.length > 0) {
        setInstagramAccounts(response.accounts);
        console.log('✅ [WIZARD] Найдено Instagram аккаунтов:', response.accounts.length);
        
        toast({
          title: "Аккаунты найдены!",
          description: `Обнаружено ${response.accounts.length} Instagram аккаунтов`
        });
        
        // Автоматически извлекаем App ID из токена если он есть
        // Для токенов Instagram можно получить App ID через Graph API
        try {
          const tokenInfoResponse = await fetch(`https://graph.facebook.com/app?access_token=${formData.accessToken}`);
          const tokenInfo = await tokenInfoResponse.json();
          
          if (tokenInfo.id && !formData.appId) {
            console.log('🔑 [WIZARD] Автоматически обнаружен App ID:', tokenInfo.id);
            setFormData(prev => ({
              ...prev,
              appId: tokenInfo.id
            }));
            
            toast({
              title: "App ID обнаружен",
              description: `Автоматически найден App ID: ${tokenInfo.id}`
            });
          }
        } catch (appIdError) {
          console.log('ℹ️ [WIZARD] Не удалось автоматически получить App ID:', appIdError);
        }
        
      } else {
        console.log('❌ [WIZARD] Аккаунты не найдены или ошибка:', response);
        setInstagramAccounts([]);
        toast({
          title: "Аккаунты не найдены",
          description: response.error || "Токен не имеет доступа к Instagram Business аккаунтам"
        });
      }
    } catch (error: any) {
      console.error('❌ [WIZARD] Error discovering Instagram accounts:', error);
      toast({
        title: "Ошибка поиска",
        description: error.response?.data?.error || "Не удалось найти Instagram аккаунты"
      });
    } finally {
      setOauthLoading(false);
    }
  };

  const testInstagramAccount = async () => {
    if (!formData.instagramId || !formData.accessToken) {
      toast({
        title: "Ошибка",
        description: "Необходимы Access Token и Instagram ID для тестирования"
      });
      return;
    }

    setLoading(true);
    
    try {
      const response = await apiRequest(`/api/campaigns/${campaignId}/test-instagram-account`, {
        method: 'POST',
        data: {
          accessToken: formData.accessToken,
          instagramId: formData.instagramId
        }
      });

      if (response.success) {
        const account = response.accountData;
        toast({
          title: "Тест успешен!",
          description: `@${account.username} (${account.name}) - ${account.followersCount} подписчиков`
        });
      }
    } catch (error: any) {
      console.error('Error testing Instagram account:', error);
      
      if (error.response?.status === 403) {
        toast({
          title: "Нет доступа",
          description: "Токен не имеет прав к этому Instagram аккаунту. Возможно он привязан к другому приложению."
        });
      } else if (error.response?.status === 400) {
        toast({
          title: "Неверный ID",
          description: "Проверьте правильность Instagram Business Account ID"
        });
      } else {
        toast({
          title: "Ошибка тестирования",
          description: error.response?.data?.error || "Не удалось протестировать аккаунт"
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!formData.appId || !formData.appSecret) {
      toast({
        title: "Ошибка",
        description: "Заполните все обязательные поля"
      });
      return;
    }

    setLoading(true);
    
    try {
      await apiRequest(`/api/campaigns/${campaignId}/instagram-settings`, {
        method: 'PATCH',
        data: {
          appId: formData.appId,
          appSecret: formData.appSecret,
          instagramId: formData.instagramId,
          accessToken: formData.accessToken
        }
      });

      toast({
        title: "Успех!",
        description: "Instagram настройки сохранены"
      });

      if (onSettingsUpdate) {
        onSettingsUpdate(formData);
      }
    } catch (error) {
      console.error('Error saving Instagram settings:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить настройки"
      });
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Facebook className="h-5 w-5 text-blue-600" />
          Шаг 1: Создайте Facebook страницу
        </CardTitle>
        <CardDescription>
          Сначала необходимо создать Facebook страницу и привязать к ней Instagram аккаунт
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Instagram className="h-4 w-4" />
          <AlertDescription>
            Instagram API работает только через Facebook Business. Необходимо иметь бизнес аккаунт Instagram, привязанный к Facebook странице.
          </AlertDescription>
        </Alert>
        
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">1</Badge>
            <div>
              <h4 className="font-medium">Создайте Facebook страницу</h4>
              <p className="text-sm text-muted-foreground">
                Перейдите на <strong>facebook.com</strong> и создайте бизнес-страницу для вашего проекта
              </p>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener noreferrer">
                  Создать страницу <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">2</Badge>
            <div>
              <h4 className="font-medium">Переведите Instagram в бизнес режим</h4>
              <p className="text-sm text-muted-foreground">
                В приложении Instagram: Настройки → Аккаунт → Переключиться на профессиональный аккаунт
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">3</Badge>
            <div>
              <h4 className="font-medium">Привяжите Instagram к Facebook странице</h4>
              <p className="text-sm text-muted-foreground">
                В Instagram: Настройки → Бизнес → Привязать страницу Facebook
              </p>
            </div>
          </div>
        </div>

        <Button onClick={() => setCurrentStep(2)} className="w-full">
          Продолжить <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );

  const renderStep2 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-blue-600" />
          Шаг 2: Создайте Facebook приложение
        </CardTitle>
        <CardDescription>
          Создайте Facebook приложение для получения API ключей
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">1</Badge>
            <div>
              <h4 className="font-medium">Перейдите в Facebook Developers</h4>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">
                  Открыть developers.facebook.com <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">2</Badge>
            <div>
              <h4 className="font-medium">Создайте новое приложение</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Выберите тип: <strong>"Business"</strong> или <strong>"Other"</strong>
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">3</Badge>
            <div className="w-full">
              <h4 className="font-medium">Настройте Callback URLs (Redirect URIs)</h4>
              <p className="text-sm text-muted-foreground mb-3">
                В настройках приложения <strong>Facebook Login → Settings</strong> добавьте оба callback URL:
              </p>
              
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Facebook Callback URL:</Label>
                  <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md flex items-center justify-between gap-2">
                    <code className="text-xs break-all">https://smm.omemo.tech/facebook-callback</code>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => copyToClipboard('https://smm.omemo.tech/facebook-callback')}
                      data-testid="button-copy-facebook-callback"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Instagram Callback URL:</Label>
                  <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md flex items-center justify-between gap-2">
                    <code className="text-xs break-all">https://smm.omemo.tech/instagram-callback</code>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => copyToClipboard('https://smm.omemo.tech/instagram-callback')}
                      data-testid="button-copy-instagram-callback"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>

              <Alert className="mt-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Скопируйте оба URL и добавьте их в поле <strong>"Valid OAuth Redirect URIs"</strong> в настройках Facebook Login
                </AlertDescription>
              </Alert>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">4</Badge>
            <div>
              <h4 className="font-medium">Добавьте продукты в приложение</h4>
              <p className="text-sm text-muted-foreground mb-2">
                В разделе "Products" добавьте:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li><strong>"Instagram Basic Display"</strong> - для доступа к Instagram</li>
                <li><strong>"Facebook Login"</strong> - для авторизации</li>
              </ul>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">5</Badge>
            <div>
              <h4 className="font-medium">Настройте разрешения в Business Manager</h4>
              <p className="text-sm text-muted-foreground mb-2">
                ⚠️ Meta обновили интерфейс! Теперь разрешения нужно добавлять вручную в Business Manager:
              </p>
              <Button variant="outline" size="sm" className="mb-3" asChild>
                <a href="https://business.facebook.com/" target="_blank" rel="noopener noreferrer">
                  Открыть Business Manager <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
              <p className="text-sm text-muted-foreground mb-2">
                Перейдите в настройки приложения и вручную добавьте следующие права:
              </p>
              <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs font-mono space-y-1">
                <div>✓ ads_management</div>
                <div>✓ instagram_basic</div>
                <div>✓ instagram_manage_insights</div>
                <div>✓ instagram_content_publish</div>
                <div>✓ pages_read_engagement</div>
                <div>✓ pages_manage_posts</div>
              </div>
              <Alert className="mt-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Важно:</strong> Без этих прав публикация в Instagram работать не будет. 
                  Все права нужно добавить вручную через Business Manager.
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCurrentStep(1)}>
            Назад
          </Button>
          <Button onClick={() => setCurrentStep(3)} className="flex-1">
            Продолжить <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderStep3 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5 text-blue-600" />
          Шаг 3: Введите данные приложения
        </CardTitle>
        <CardDescription>
          Скопируйте App ID и App Secret из Facebook приложения
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Важно:</strong> Это НЕ токены Instagram! Нужны именно App ID и App Secret из настроек Facebook приложения в разделе "Basic Settings"
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <Label htmlFor="appId">Facebook App ID *</Label>
            <Input
              id="appId"
              type="text"
              placeholder="Только цифры, например: 1234567890123456"
              value={formData.appId}
              onChange={(e) => {
                // Оставляем только цифры
                const value = e.target.value.replace(/\D/g, '');
                setFormData(prev => ({ ...prev, appId: value }));
              }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              15-16 цифр из настроек Facebook приложения (НЕ Instagram токен!)
            </p>
            {formData.appId && formData.appId.length < 10 && (
              <p className="text-xs text-red-500 mt-1">
                Слишком короткий App ID - проверьте правильность
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="appSecret">Facebook App Secret *</Label>
            <Input
              id="appSecret"
              type="password"
              placeholder="Строка из букв и цифр, начинается с цифр"
              value={formData.appSecret}
              onChange={(e) => setFormData(prev => ({ ...prev, appSecret: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Секретный ключ из настроек Facebook приложения
            </p>
          </div>

          <div>
            <Label htmlFor="accessToken">Access Token</Label>
            <Input
              id="accessToken"
              type="text"
              placeholder="Будет получен автоматически после OAuth авторизации"
              value={formData.accessToken}
              onChange={(e) => setFormData(prev => ({ ...prev, accessToken: e.target.value }))}
              readOnly
            />
            <p className="text-xs text-muted-foreground mt-1">
              {formData.accessToken ? 'Токен получен ✓' : 'Для получения токена перейдите к шагу 4'}
            </p>
          </div>
          
          <div>
            <Label htmlFor="instagramId">Instagram Business Account ID</Label>
            <Input
              id="instagramId"
              type="text"
              placeholder="17841422577074562"
              value={formData.instagramId}
              onChange={(e) => setFormData(prev => ({ ...prev, instagramId: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {formData.instagramId ? '✅ Instagram ID указан' : 'Обязательно укажите ID вашего Instagram Business аккаунта'}
            </p>
            <Alert className="mt-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Важно:</strong> Если автопоиск не находит аккаунты, введите Business Account ID вручную. 
                Найти его можно в Graph API Explorer: <code>me/accounts?fields=instagram_business_account</code>
              </AlertDescription>
            </Alert>
            
            {/* Автопоиск всех доступных аккаунтов */}
            {formData.accessToken && (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={findAllInstagramAccounts}
                  disabled={!formData.accessToken || oauthLoading}
                  className="w-full"
                >
                  {oauthLoading ? (
                    "🔍 Ищем все доступные аккаунты..."
                  ) : (
                    "🔍 Найти все Instagram аккаунты по токену"
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">
                  Автоматически найдет все аккаунты, которыми можно управлять через токен
                </p>
              </div>
            )}

            {/* Отображение найденных аккаунтов */}
            {instagramAccounts.length > 0 && (
              <div className="mt-3 space-y-2">
                <Label className="text-sm font-medium">Найденные Instagram аккаунты:</Label>
                <div className="space-y-2">
                  {instagramAccounts.map((account, index) => (
                    <div 
                      key={account.id}
                      className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          instagramId: account.id
                        }));
                        toast({
                          title: "Аккаунт выбран",
                          description: `${account.name} (@${account.username})`
                        });
                      }}
                    >
                      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        📸
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{account.name}</div>
                        <div className="text-sm text-muted-foreground">
                          @{account.username} • {account.followers_count} подписчиков
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ID: {account.id}
                        </div>
                      </div>
                      <Badge variant="secondary">
                        {formData.instagramId === account.id ? 'Выбран' : 'Выбрать'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Кнопки быстрого выбора известных аккаунтов */}
            <div className="mt-3 space-y-2">
              <Label className="text-sm font-medium">Или выберите известный аккаунт:</Label>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormData(prev => ({
                      ...prev,
                      instagramId: "17841422577074562"
                    }));
                  }}
                  className="justify-start text-xs"
                >
                  📸 @it_zhdanov (17841422577074562)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormData(prev => ({
                      ...prev,
                      instagramId: "17841422578516105"
                    }));
                  }}
                  className="justify-start text-xs"
                >
                  📸 @omemo.tech (17841422578516105)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormData(prev => ({
                      ...prev,
                      instagramId: "17841474548013708"
                    }));
                  }}
                  className="justify-start text-xs"
                >
                  🤖 @smm_manager_niap (17841474548013708)
                </Button>
              </div>
            </div>

            {formData.instagramId && formData.accessToken && (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={testInstagramAccount}
                  disabled={!formData.instagramId || !formData.accessToken}
                  className="w-full"
                >
                  🧪 Протестировать Instagram Account ID
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCurrentStep(2)}>
            Назад
          </Button>
          <Button 
            onClick={() => setCurrentStep(4)} 
            className="flex-1"
            disabled={!formData.appId || !formData.appSecret || !formData.instagramId}
          >
            Продолжить <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderStep4 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LinkIcon className="h-5 w-5 text-green-600" />
          Шаг 4: Авторизация Instagram
        </CardTitle>
        <CardDescription>
          Получите долгосрочный токен доступа через OAuth
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Instagram className="h-4 w-4" />
          <AlertDescription>
            Система автоматически получит долгосрочный токен и сохранит его в настройках кампании
          </AlertDescription>
        </Alert>

        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Как это работает:</h4>
          <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-decimal list-inside">
            <li>Откроется окно авторизации Facebook с принудительным запросом новых разрешений</li>
            <li>Вы авторизуете доступ к Instagram Business аккаунту для этого конкретного приложения</li>
            <li>Система получит краткосрочный токен и обменяет на долгосрочный</li>
            <li>Все данные Instagram сохранятся в настройках этой кампании</li>
            <li>Готово! Каждое приложение будет иметь свой уникальный токен</li>
          </ol>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Новая функция:</strong> Система теперь принудительно запрашивает новые токены для каждого Facebook приложения через параметр auth_type=rerequest. Это предотвращает повторное использование одного токена для разных приложений.
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCurrentStep(3)}>
            Назад
          </Button>
          <Button 
            onClick={startOAuthFlow}
            disabled={oauthLoading || !formData.appId || !formData.appSecret}
            className="flex-1"
          >
            {oauthLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Авторизовать Instagram
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <h4 className="font-medium">Или сохраните настройки и перейдите к группам:</h4>
          <div className="flex gap-2">
            <Button 
              onClick={handleSaveSettings}
              variant="outline"
              disabled={loading}
              className="flex-1"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить настройки
            </Button>
            <Button 
              onClick={() => {
                setFacebookToken(formData.accessToken);
                setCurrentStep(5);
              }}
              disabled={!formData.accessToken}
              className="flex-1"
            >
              К группам Facebook <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderStep5 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-blue-600" />
          Шаг 5: Настройка приложения в Business Manager
        </CardTitle>
        <CardDescription>
          Финальная настройка прав доступа и callback URLs в Business Portfolio
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Шаг 1: Создание Business Portfolio */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">1</Badge>
            <div className="flex-1">
              <h4 className="font-medium mb-2">Создайте или откройте Business Portfolio</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Перейдите в Business Manager и создайте бизнес-портфолио, если его еще нет
              </p>
              <Button variant="outline" size="sm" asChild data-testid="button-open-business-manager">
                <a href="https://business.facebook.com/" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Перейти к созданию Бизнес-портфолио
                </a>
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Шаг 2: Добавление прав доступа */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">2</Badge>
            <div className="flex-1">
              <h4 className="font-medium mb-2">Добавьте права доступа вручную</h4>
              <p className="text-sm text-muted-foreground mb-3">
                В настройках вашего приложения добавьте следующие разрешения:
              </p>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
                <h5 className="font-medium text-sm text-blue-900 dark:text-blue-100">Список обязательных прав:</h5>
                <div className="grid grid-cols-1 gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <code className="text-xs">ads_management</code>
                    <span className="text-xs text-muted-foreground">- управление рекламой</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <code className="text-xs">instagram_basic</code>
                    <span className="text-xs text-muted-foreground">- базовый доступ к Instagram</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <code className="text-xs">instagram_manage_insights</code>
                    <span className="text-xs text-muted-foreground">- доступ к аналитике</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <code className="text-xs">instagram_content_publish</code>
                    <span className="text-xs text-muted-foreground">- публикация контента</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <code className="text-xs">pages_read_engagement</code>
                    <span className="text-xs text-muted-foreground">- чтение взаимодействий</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <code className="text-xs">pages_manage_posts</code>
                    <span className="text-xs text-muted-foreground">- управление постами</span>
                  </div>
                </div>
              </div>

              <Alert className="mt-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Важно:</strong> Все права нужно добавить вручную через Business Manager. 
                  Без них публикация работать не будет!
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </div>

        <Separator />

        {/* Шаг 3: Callback URLs */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="mt-1">3</Badge>
            <div className="flex-1">
              <h4 className="font-medium mb-2">Добавьте Callback URLs в настройки приложения</h4>
              <p className="text-sm text-muted-foreground mb-3">
                В разделе <strong>Facebook Login → Settings → Valid OAuth Redirect URIs</strong> добавьте оба URL:
              </p>
              
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Facebook Callback URL:</Label>
                  <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md flex items-center justify-between gap-2">
                    <code className="text-xs break-all">https://smm.omemo.tech/facebook-callback</code>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => copyToClipboard('https://smm.omemo.tech/facebook-callback')}
                      data-testid="button-copy-facebook-callback-step5"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Instagram Callback URL:</Label>
                  <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md flex items-center justify-between gap-2">
                    <code className="text-xs break-all">https://smm.omemo.tech/instagram-callback</code>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => copyToClipboard('https://smm.omemo.tech/instagram-callback')}
                      data-testid="button-copy-instagram-callback-step5"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Навигация */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCurrentStep(4)}>
            Назад
          </Button>
          <Button 
            onClick={() => {
              toast({
                title: "Настройка завершена!",
                description: "Instagram API готов к использованию. Все настройки сохранены.",
              });
              onSettingsUpdate?.(formData);
            }}
            className="flex-1"
            data-testid="button-complete-setup"
          >
            Завершить настройку <CheckCircle className="ml-1 h-4 w-4" />
          </Button>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            После завершения настройки вы сможете публиковать контент в Instagram и Facebook 
            через эту кампанию. Убедитесь, что все шаги выполнены корректно.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );

  const resetWizard = () => {
    setFormData({
      appId: '',
      appSecret: '',
      accessToken: '',
      instagramId: ''
    });
    setCurrentStep(1);
    setFacebookToken('');
    toast({
      title: "Настройки сброшены",
      description: "Можете начать заново с новым Facebook приложением"
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Instagram API Setup Wizard</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={resetWizard}>
            Сбросить настройки
          </Button>
          <Badge variant="outline">Шаг {currentStep} из 5</Badge>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center space-x-2">
        {[1, 2, 3, 4, 5].map((step) => (
          <div key={step} className="flex items-center">
            <div 
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step <= currentStep 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {step < currentStep ? <CheckCircle className="h-4 w-4" /> : step}
            </div>
            {step < 5 && (
              <div className={`flex-1 h-1 ${step < currentStep ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div>
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        {currentStep === 5 && renderStep5()}
      </div>
    </div>
  );
};

export default InstagramSetupWizardComplete;