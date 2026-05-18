import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { SiTiktok } from 'react-icons/si';

interface TikTokAccount {
  id: string;
  account_name: string;
  account_username: string;
  account_avatar?: string;
  campaign_id?: string;
}

interface TikTokSetupWizardProps {
  campaignId: string;
  clientKey?: string;
  clientSecret?: string;
  onConnected?: (account: TikTokAccount) => void;
  onClose?: () => void;
}

export default function TikTokSetupWizard({ campaignId, clientKey, clientSecret, onConnected, onClose }: TikTokSetupWizardProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [connectedAccount, setConnectedAccount] = useState<TikTokAccount | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const syncToCampaignSettings = async () => {
    try {
      await fetch('/api/tiktok/sync-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ campaignId })
      });
    } catch (e) {
      console.error('[TikTokSetupWizard] sync-settings error:', e);
    }
  };

  const loadConnectedAccount = async (autoSync = false) => {
    setIsLoadingAccounts(true);
    try {
      const resp = await fetch('/api/tiktok/accounts', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await resp.json();
      if (data.success && data.accounts?.length > 0) {
        const campaignAccount = data.accounts.find((a: TikTokAccount) => a.campaign_id === campaignId)
          || data.accounts[0];
        setConnectedAccount(campaignAccount);
        // Синхронизируем в social_media_settings кампании (для аккаунтов подключённых до этого фикса)
        if (autoSync) await syncToCampaignSettings();
      } else {
        setConnectedAccount(null);
      }
    } catch (e) {
      console.error('[TikTokSetupWizard] Error loading accounts:', e);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadConnectedAccount(true); // autoSync=true: синхронизирует существующие аккаунты в social_media_settings

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'TIKTOK_OAUTH_SUCCESS') {
        const { accountName, username } = event.data.data || {};
        toast({ title: 'TikTok подключён!', description: `Аккаунт @${username || accountName} успешно подключён` });
        setTimeout(() => loadConnectedAccount(), 1000);
        if (onConnected) {
          onConnected({ id: '', account_name: accountName, account_username: username, campaign_id: campaignId });
        }
      }
      if (event.data?.type === 'TIKTOK_OAUTH_ERROR') {
        toast({ variant: 'destructive', title: 'Ошибка', description: event.data.error || 'Не удалось подключить TikTok' });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [campaignId]);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const resp = await fetch('/api/tiktok/auth/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ campaignId, clientKey: clientKey || undefined, clientSecret: clientSecret || undefined })
      });
      const data = await resp.json();

      if (data.success && data.authUrl) {
        window.open(data.authUrl, 'tiktok-auth', 'width=600,height=700,scrollbars=yes');
        toast({ title: 'Откроется окно TikTok', description: 'Войдите в аккаунт и разрешите доступ' });
      } else {
        toast({
          variant: 'destructive',
          title: 'Ошибка',
          description: data.error || data.details || 'Не удалось запустить авторизацию. Убедитесь что TikTok API настроен администратором.'
        });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Ошибка', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connectedAccount) return;
    setIsDisconnecting(true);
    try {
      const resp = await fetch(`/api/tiktok/accounts/${connectedAccount.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await resp.json();
      if (data.success) {
        setConnectedAccount(null);
        toast({ title: 'TikTok отключён', description: 'Аккаунт успешно отключён' });
      } else {
        toast({ variant: 'destructive', title: 'Ошибка', description: data.error });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Ошибка', description: e.message });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-xl bg-gray-50 dark:bg-gray-900/30">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center flex-shrink-0">
          <SiTiktok className="text-white w-5 h-5" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">TikTok</h3>
          <p className="text-xs text-muted-foreground">Подключение через TikTok OAuth</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
        )}
      </div>

      {isLoadingAccounts ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Проверка подключения...
        </div>
      ) : connectedAccount ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            {connectedAccount.account_avatar && (
              <img src={connectedAccount.account_avatar} alt="" className="w-8 h-8 rounded-full" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                <span className="font-medium text-sm text-green-800 dark:text-green-200 truncate">
                  {connectedAccount.account_name}
                </span>
              </div>
              {connectedAccount.account_username && (
                <p className="text-xs text-green-700 dark:text-green-300 ml-6">@{connectedAccount.account_username}</p>
              )}
            </div>
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 border-0 text-xs">
              Подключён
            </Badge>
          </div>

          <div className="flex gap-2">
            <Button
              data-testid="button-tiktok-reconnect"
              type="button"
              variant="outline"
              size="sm"
              onClick={handleConnect}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ExternalLink className="h-4 w-4 mr-1" />}
              Переподключить
            </Button>
            <Button
              data-testid="button-tiktok-disconnect"
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
              Отключить
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">Sandbox-режим</p>
            <p>TikTok работает в режиме тестирования. Только аккаунты добавленные в TikTok Developer Portal смогут подключиться.</p>
          </div>

          <Button
            data-testid="button-tiktok-connect"
            type="button"
            className="w-full bg-black hover:bg-gray-800 text-white"
            onClick={handleConnect}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <SiTiktok className="h-4 w-4 mr-2" />
            )}
            Подключить TikTok аккаунт
          </Button>
        </div>
      )}
    </div>
  );
}
