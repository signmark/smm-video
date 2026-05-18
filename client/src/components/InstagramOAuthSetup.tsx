import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCampaignStore } from "@/lib/campaignStore";
import { api } from "@/lib/api";

interface InstagramOAuthSetupProps {
  campaignId: string;
  onAuthComplete?: () => void;
}

interface InstagramOAuthStatus {
  isConnected: boolean;
  username?: string;
  profilePicture?: string;
  lastConnected?: string;
  accessToken?: string;
}

export function InstagramOAuthSetup({ campaignId, onAuthComplete }: InstagramOAuthSetupProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<InstagramOAuthStatus>({
    isConnected: false
  });
  const { toast } = useToast();
  const { selectedCampaign } = useCampaignStore();

  // Проверяем текущий статус авторизации
  useEffect(() => {
    checkAuthStatus();
  }, [campaignId]);

  const checkAuthStatus = async () => {
    try {
      const response = await api.get(`/api/social/instagram/oauth/status/${campaignId}`);
      if (response.data.success) {
        setAuthStatus(response.data.status);
      }
    } catch (error) {
      console.error('Ошибка проверки статуса Instagram OAuth:', error);
    }
  };

  const startOAuthFlow = async () => {
    if (!selectedCampaign?.name) {
      toast({
        title: "Ошибка",
        description: "Не удалось определить название кампании",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      // Создаем URL для OAuth авторизации
      const oauthUrl = `https://inst-oauth.smmniap.pw/?campaign_id=${campaignId}&name=${encodeURIComponent(selectedCampaign.name)}`;
      
      // Открываем окно для авторизации
      const authWindow = window.open(
        oauthUrl,
        'instagram-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!authWindow) {
        throw new Error('Не удалось открыть окно авторизации. Проверьте настройки блокировщика всплывающих окон.');
      }

      // Отслеживаем закрытие окна
      const checkClosed = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(checkClosed);
          setIsLoading(false);
          
          // Проверяем статус после закрытия окна (небольшая задержка для обработки callback)
          setTimeout(() => {
            checkAuthStatus();
          }, 2000);
        }
      }, 1000);

      // Слушаем сообщения от OAuth окна
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== 'https://inst-oauth.smmniap.pw') {
          return;
        }

        if (event.data.type === 'instagram-oauth-success') {
          clearInterval(checkClosed);
          authWindow.close();
          setIsLoading(false);
          
          toast({
            title: "Успешно!",
            description: "Instagram авторизация завершена успешно",
          });

          // Обновляем статус и уведомляем родительский компонент
          checkAuthStatus();
          onAuthComplete?.();
        } else if (event.data.type === 'instagram-oauth-error') {
          clearInterval(checkClosed);
          authWindow.close();
          setIsLoading(false);
          
          toast({
            title: "Ошибка авторизации",
            description: event.data.message || "Произошла ошибка при авторизации Instagram",
            variant: "destructive"
          });
        }
      };

      window.addEventListener('message', handleMessage);

      // Очистка слушателя при размонтировании
      return () => {
        window.removeEventListener('message', handleMessage);
        clearInterval(checkClosed);
      };

    } catch (error: any) {
      setIsLoading(false);
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const disconnectInstagram = async () => {
    setIsLoading(true);
    
    try {
      const response = await api.delete(`/api/social/instagram/oauth/disconnect/${campaignId}`);
      
      if (response.data.success) {
        setAuthStatus({ isConnected: false });
        toast({
          title: "Успешно",
          description: "Instagram аккаунт отключен"
        });
        onAuthComplete?.();
      }
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: "Не удалось отключить Instagram аккаунт",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = () => {
    if (isLoading) {
      return <Loader2 className="h-4 w-4 animate-spin" />;
    }
    
    if (authStatus.isConnected) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getStatusBadge = () => {
    if (authStatus.isConnected) {
      return <Badge variant="default" className="bg-green-500">Подключен</Badge>;
    }
    
    return <Badge variant="destructive">Не подключен</Badge>;
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CardTitle className="text-lg">Instagram OAuth авторизация</CardTitle>
            {getStatusIcon()}
          </div>
          {getStatusBadge()}
        </div>
        <CardDescription>
          Альтернативный способ подключения Instagram через OAuth сервис
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {authStatus.isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex-shrink-0">
                {authStatus.profilePicture ? (
                  <img 
                    src={authStatus.profilePicture} 
                    alt="Profile" 
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="h-10 w-10 bg-gray-300 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm">IG</span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium text-green-800">
                  @{authStatus.username || 'Instagram аккаунт'}
                </p>
                <p className="text-sm text-green-600">
                  Подключен {authStatus.lastConnected ? new Date(authStatus.lastConnected).toLocaleDateString() : 'недавно'}
                </p>
              </div>
            </div>

            <div className="flex space-x-2">
              <Button 
                onClick={disconnectInstagram}
                disabled={isLoading}
                variant="outline"
                size="sm"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Отключить
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Как работает OAuth авторизация:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    <li>Откроется окно для авторизации в Instagram</li>
                    <li>Войдите в свой Instagram аккаунт</li>
                    <li>Предоставьте разрешения для публикации</li>
                    <li>Токены автоматически сохранятся в настройки кампании</li>
                  </ul>
                </div>
              </div>
            </div>

            <Button 
              onClick={startOAuthFlow}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Авторизация...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Подключить Instagram
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}