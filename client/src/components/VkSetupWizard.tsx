import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, ExternalLink, ArrowRight, Loader2, ChevronDown, ChevronUp, RefreshCw, Webhook, Copy, Check, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface VkSetupWizardProps {
  campaignId: string;
  onComplete: () => void;
  onCancel: () => void;
}

const VkSetupWizard: React.FC<VkSetupWizardProps> = ({ campaignId, onComplete, onCancel }) => {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [mode, setMode] = useState<'webhook' | 'manual'>('webhook');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isOAuth2Waiting, setIsOAuth2Waiting] = useState(false);
  const [tokenReceived, setTokenReceived] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImplicit, setShowImplicit] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<Array<{
    id: string; name: string; screen_name: string; members_count: number;
  }>>([]);

  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const oauth2PopupRef = useRef<Window | null>(null);
  const oauth2ListenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // URL с одноразовым state выдаёт сервер (prepare). Именно его пользователь
  // вставляет в needanapp — без валидного state публичный callback отклоняется.
  const [webhookUrl, setWebhookUrl] = useState('');
  const [preparingWebhook, setPreparingWebhook] = useState(false);

  const prepareWebhook = async () => {
    setPreparingWebhook(true);
    try {
      const resp = await fetch(`/api/vk/token-webhook/${campaignId}/prepare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!resp.ok) throw new Error('prepare failed');
      const data = await resp.json();
      setWebhookUrl(data.webhookUrl);
      return data.webhookUrl as string;
    } finally {
      setPreparingWebhook(false);
    }
  };

  // Готовим свежий URL при входе в webhook-режим.
  useEffect(() => {
    if (mode === 'webhook' && campaignId) {
      prepareWebhook().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, campaignId]);

  const steps = [
    { title: 'Подключение VK', description: mode === 'webhook' ? 'Получение токена через внешний сервис' : 'OAuth2 авторизация VK' },
    { title: 'Выбор группы', description: 'Выбор VK группы для публикации' },
    { title: 'Готово', description: 'Настройка завершена' }
  ];

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (oauth2ListenerRef.current) window.removeEventListener('message', oauth2ListenerRef.current);
    };
  }, []);

  const copyWebhook = async () => {
    // Гарантируем свежий state на момент копирования.
    const url = webhookUrl || (await prepareWebhook().catch(() => ''));
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startPolling = () => {
    setIsPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/vk/token-webhook/${campaignId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        });
        const data = await resp.json();
        if (data.ready) {
          clearInterval(pollRef.current!);
          setIsPolling(false);
          setTokenReceived(true);
          toast({ title: 'Токен получен!', description: 'Загружаем список групп...' });
          await fetchVkGroupsFromCampaign();
        }
      } catch {}
    }, 3000);
    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        setIsPolling(false);
        if (!tokenReceived) {
          toast({ title: 'Время ожидания истекло', description: 'Токен не получен за 5 минут. Попробуйте ещё раз.', variant: 'destructive' });
        }
      }
    }, 5 * 60 * 1000);
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setIsPolling(false);
  };

  const startOAuth2 = () => {
    const oauth2Url = `/api/vk/oauth2/start?campaign_id=${campaignId}`;
    const popup = window.open(oauth2Url, 'vk-oauth2', 'width=600,height=700,scrollbars=yes');
    oauth2PopupRef.current = popup;
    setIsOAuth2Waiting(true);

    const listener = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'VK_OAUTH2_SUCCESS') {
        window.removeEventListener('message', listener);
        oauth2ListenerRef.current = null;
        setIsOAuth2Waiting(false);
        toast({ title: 'Авторизация успешна!', description: 'Токен с автообновлением сохранён. Загружаем группы...' });
        await queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
        await fetchVkGroupsFromCampaign();
      } else if (e.data?.type === 'VK_OAUTH_ERROR') {
        window.removeEventListener('message', listener);
        oauth2ListenerRef.current = null;
        setIsOAuth2Waiting(false);
        toast({ title: 'Ошибка авторизации', description: e.data.error || 'Неизвестная ошибка', variant: 'destructive' });
      }
    };
    oauth2ListenerRef.current = listener;
    window.addEventListener('message', listener);

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        if (isOAuth2Waiting) {
          setIsOAuth2Waiting(false);
          window.removeEventListener('message', listener);
          oauth2ListenerRef.current = null;
        }
      }
    }, 1000);
  };

  const fetchVkGroupsFromCampaign = async () => {
    setIsProcessing(true);
    try {
      // Серверный endpoint — токен НЕ передаётся в браузер
      const resp = await fetch(`/api/campaigns/${campaignId}/vk-groups`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await resp.json();
      if (data.success && data.groups) {
        setAvailableGroups(data.groups);
        setCurrentStep(2);
      } else {
        throw new Error(data.error || 'Ошибка получения групп');
      }
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const fetchVkGroups = async (token: string) => {
    setIsProcessing(true);
    try {
      const response = await fetch(`/api/vk/groups?access_token=${encodeURIComponent(token)}`);
      const data = await response.json();
      if (data.success && data.groups) {
        setAvailableGroups(data.groups);
        setCurrentStep(2);
      } else {
        throw new Error(data.error || 'Ошибка получения групп');
      }
    } catch (error: any) {
      toast({ title: 'Ошибка получения групп', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const selectVkGroup = async (groupId: string, groupName: string) => {
    setIsProcessing(true);
    try {
      // Только groupId/groupName — токен уже в Directus, сервер сохранит его через mergeOAuthSettings
      const body: Record<string, any> = {
        groupId,
        groupName,
        setupCompletedAt: new Date().toISOString(),
      };

      const response = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (data.success) {
        setCurrentStep(3);
        setTimeout(() => onComplete(), 2000);
      } else {
        throw new Error(data.error || 'Ошибка сохранения настроек');
      }
    } catch (error: any) {
      toast({ title: 'Ошибка сохранения', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const renderWebhookStep = () => (
    <div className="space-y-4">
      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription className="text-sm space-y-1">
          <div><strong>Как получить токен через внешний сервис:</strong></div>
          <div>1. Зайдите на <a href="https://vk.needanapp.ru" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium">vk.needanapp.ru</a></div>
          <div>2. Нажмите <strong>«Получить токен»</strong>, авторизуйтесь в VK</div>
          <div>3. В поле <strong>«Отправить данные в webhook»</strong> вставьте URL ниже</div>
          <div>4. Нажмите «Отправить» — токены придут автоматически</div>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Webhook className="h-4 w-4 text-blue-500" />
            Webhook URL для вашего сервиса
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-100 border rounded px-2 py-2 break-all font-mono">
              {webhookUrl || (preparingWebhook ? 'Генерируем защищённый URL…' : '—')}
            </code>
            <Button variant="outline" size="sm" onClick={copyWebhook} className="shrink-0" data-testid="button-copy-webhook">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Принимает POST с полями: <code className="bg-gray-100 px-1 rounded">access_token</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">refresh_token</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">device_id</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">client_id</code>
          </p>
        </CardContent>
      </Card>

      {!isPolling ? (
        <Button onClick={startPolling} className="w-full" data-testid="button-vk-start-waiting">
          <RefreshCw className="mr-2 h-4 w-4" />
          Жду токен (начать ожидание)
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-3 py-3 border rounded-md bg-blue-50">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <span className="text-sm text-blue-700">Ожидаю токен от сервиса...</span>
          </div>
          <Button variant="outline" onClick={stopPolling} className="w-full" size="sm">
            Отменить ожидание
          </Button>
        </div>
      )}

      <div className="text-center pt-1">
        <button className="text-xs text-gray-400 hover:text-gray-600 underline" onClick={() => setMode('manual')}>
          Войти через VK напрямую
        </button>
      </div>
    </div>
  );

  const renderManualStep = () => (
    <div className="space-y-4">
      <Alert className="bg-green-50 border-green-200">
        <AlertDescription className="text-sm flex items-start gap-2">
          <Shield className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
          <span>
            <strong>Рекомендуемый способ.</strong> Нажмите кнопку ниже — откроется окно авторизации VK.
            Токен будет обновляться автоматически, публикации не прервутся.
            Включены разрешения: стена, группы, фото, <strong>видео</strong>.
            {" "}<span className="text-amber-700">Если VK уже подключён — переподключитесь, чтобы разрешить публикацию видеозаписей.</span>
          </span>
        </AlertDescription>
      </Alert>

      {!isOAuth2Waiting ? (
        <Button onClick={startOAuth2} className="w-full" size="lg" data-testid="button-vk-oauth2">
          <ExternalLink className="mr-2 h-5 w-5" />
          Войти через VK (с автообновлением токена)
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-3 py-3 border rounded-md bg-green-50">
            <Loader2 className="h-5 w-5 animate-spin text-green-600" />
            <span className="text-sm text-green-700">Ожидаю авторизацию в окне VK...</span>
          </div>
          <Button variant="outline" onClick={() => { setIsOAuth2Waiting(false); if (oauth2PopupRef.current) oauth2PopupRef.current.close(); }} className="w-full" size="sm">
            Отменить
          </Button>
        </div>
      )}

      <div>
        <button type="button" className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          onClick={() => setShowImplicit(!showImplicit)}>
          {showImplicit ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Вставить токен вручную (устаревший способ, токен живёт 24ч)
        </button>
        {showImplicit && (
          <div className="mt-3 space-y-3 p-3 border rounded-md bg-gray-50">
            <Alert>
              <AlertDescription className="text-xs text-amber-700">
                ⚠️ Токен из implicit flow живёт <strong>24 часа</strong> и не обновляется автоматически.
                На следующий день публикации остановятся.
              </AlertDescription>
            </Alert>
            <Button variant="outline" className="w-full text-sm" onClick={() => window.open(
              'https://id.vk.com/auth?return_auth_hash=1eeddfeb3ea9a85e79&redirect_uri=https%3A%2F%2Foauth.vk.com%2Fblank.html&redirect_uri_hash=3d444d2d80c8edbe34&force_hash=1&app_id=6121396&response_type=token&code_challenge=&code_challenge_method=&scope=408923359&state=',
              'vk-auth', 'width=600,height=700'
            )} data-testid="button-vk-open-auth">
              <ExternalLink className="mr-2 h-4 w-4" /> Открыть авторизацию VK (implicit)
            </Button>
            <div>
              <label className="text-xs font-medium block mb-1">Access Token:</label>
              <input type="text" placeholder="vk1.a...." value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
                data-testid="input-vk-access-token"
                className="w-full px-3 py-2 border rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <button type="button" className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Данные для автообновления (необязательно)
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-2 p-3 border rounded-md bg-white">
                  <p className="text-xs text-gray-500">Если есть refresh_token — токен будет обновляться автоматически.</p>
                  <div>
                    <label className="text-xs font-medium block mb-1">Refresh Token:</label>
                    <input type="text" placeholder="vkr1...." value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)}
                      data-testid="input-vk-refresh-token"
                      className="w-full px-2 py-1.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium block mb-1">Client ID:</label>
                      <input type="text" placeholder="51234567" value={clientId} onChange={(e) => setClientId(e.target.value)}
                        data-testid="input-vk-client-id"
                        className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">Device ID:</label>
                      <input type="text" placeholder="device_..." value={deviceId} onChange={(e) => setDeviceId(e.target.value)}
                        data-testid="input-vk-device-id"
                        className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Button onClick={() => accessToken.trim() && fetchVkGroups(accessToken.trim())}
              disabled={!accessToken.trim() || isProcessing} className="w-full" data-testid="button-vk-continue">
              {isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загрузка групп...</> : <>Продолжить <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </div>
        )}
      </div>

      <div className="text-center">
        <button className="text-xs text-gray-400 hover:text-gray-600 underline" onClick={() => setMode('webhook')}>
          ← Использовать webhook
        </button>
      </div>
    </div>
  );

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return mode === 'webhook' ? renderWebhookStep() : renderManualStep();
      case 2:
        return (
          <div className="space-y-4">
            <Alert><AlertDescription>Выберите VK группу для публикации:</AlertDescription></Alert>
            <div className="grid gap-3 max-h-96 overflow-y-auto">
              {availableGroups.map((group) => (
                <Card key={group.id} className="cursor-pointer hover:bg-gray-50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-semibold">{group.name}</h4>
                        <p className="text-sm text-gray-600">@{group.screen_name}</p>
                        <Badge variant="outline" className="mt-1">{group.members_count.toLocaleString('ru-RU')} участников</Badge>
                      </div>
                      <Button onClick={() => selectVkGroup(group.id, group.name)} disabled={isProcessing} size="sm"
                        data-testid={`button-select-vk-group-${group.id}`}>
                        {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Выбрать'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {availableGroups.length === 0 && !isProcessing && (
                <Alert><AlertDescription>Группы не найдены. Убедитесь, что вы администратор хотя бы одной группы.</AlertDescription></Alert>
              )}
            </div>
          </div>
        );
      case 3:
        return (
          <div className="text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h3 className="text-xl font-semibold">Настройка VK завершена!</h3>
            <p className="text-gray-600">VK интеграция успешно настроена.</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Настройка VK интеграции</h2>
        <div className="flex space-x-2 items-center">
          {steps.map((step, index) => (
            <div key={index} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                currentStep > index + 1 ? 'bg-green-500 text-white' :
                currentStep === index + 1 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {currentStep > index + 1 ? <CheckCircle className="h-4 w-4" /> : index + 1}
              </div>
              {index < steps.length - 1 && (
                <div className={`w-16 h-1 mx-2 ${currentStep > index + 1 ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <h3 className="font-semibold">{steps[currentStep - 1]?.title}</h3>
          <p className="text-sm text-gray-600">{steps[currentStep - 1]?.description}</p>
        </div>
      </div>

      {renderStep()}

      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={onCancel}>Отмена</Button>
        {currentStep === 3 && <Button onClick={onComplete}>Завершить</Button>}
      </div>
    </div>
  );
};

export default VkSetupWizard;
