import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface InstagramAccount {
  id: string;
  name: string;
  username?: string;
}

interface InstagramAccountSwitcherProps {
  campaignId: string;
  currentAccountId?: string;
  onAccountChanged?: () => void;
}

const InstagramAccountSwitcher: React.FC<InstagramAccountSwitcherProps> = ({ 
  campaignId, 
  currentAccountId,
  onAccountChanged 
}) => {
  const [availableAccounts, setAvailableAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const getInstagramAccountName = (accountId: string) => {
    return 'Instagram Business Account';
  };

  const loadAvailableAccounts = async () => {
    setLoading(true);
    try {
      // Получаем access token из настроек кампании
      const settingsResponse = await fetch(`/api/campaigns/${campaignId}/instagram-settings`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!settingsResponse.ok) return;

      const settingsData = await settingsResponse.json();
      if (!settingsData.success || !settingsData.settings?.accessToken) return;

      // Получаем доступные аккаунты
      const accountsResponse = await fetch(`/api/campaigns/${campaignId}/discover-instagram-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          accessToken: settingsData.settings.accessToken
        })
      });

      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json();
        if (accountsData.success && accountsData.accounts) {
          const accounts = accountsData.accounts.map((acc: any) => ({
            id: acc.id,
            name: acc.name || getInstagramAccountName(acc.id), // Получено из API
            username: acc.username
          }));
          setAvailableAccounts(accounts);
          console.log('📱 Instagram accounts loaded from API:', accounts);
        }
      }
    } catch (error) {
      console.error('Error loading Instagram accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchAccount = async (newAccountId: string, accountName: string) => {
    setLoading(true);
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
              businessAccountId: newAccountId
            }
          }
        })
      });

      if (response.ok) {
        toast({
          title: "Instagram аккаунт изменен",
          description: `Выбран аккаунт: ${accountName}`
        });
        setOpen(false);
        if (onAccountChanged) {
          onAccountChanged();
        }
      } else {
        throw new Error('Failed to switch account');
      }
    } catch (error) {
      toast({
        title: "Ошибка переключения аккаунта",
        description: "Не удалось изменить Instagram аккаунт",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => {
            setOpen(true);
            loadAvailableAccounts();
          }}
          disabled={!campaignId}
        >
          📱 Переключить Instagram
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Выберите Instagram аккаунт</DialogTitle>
        </DialogHeader>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : availableAccounts.length > 0 ? (
          <div className="space-y-2">
            {availableAccounts.map((account) => (
              <Card key={account.id} className="cursor-pointer hover:bg-gray-50 transition-colors">
                <CardContent className="p-3">
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
                      onClick={() => switchAccount(account.id, account.name)}
                      disabled={loading || currentAccountId === account.id}
                      size="sm"
                      variant={currentAccountId === account.id ? "default" : "outline"}
                    >
                      {currentAccountId === account.id ? '✓ Текущий' : 'Выбрать'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            Нет доступных Instagram аккаунтов для переключения
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InstagramAccountSwitcher;