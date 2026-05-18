import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, ExternalLink, ArrowRight, Loader2, Facebook } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface InstagramSetupWizardProps {
  campaignId: string;
  onComplete: () => void;
  onCancel: () => void;
}

const InstagramSetupWizard: React.FC<InstagramSetupWizardProps> = ({ campaignId, onComplete, onCancel }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [formData, setFormData] = useState({
    appId: '',
    appSecret: '',
    accessToken: '',
    businessAccountId: ''
  });
  
  const { toast } = useToast();

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
          campaignId: campaignId
        })
      });

      const data = await response.json();
      
      if (data.success && data.authUrl) {
        // Открываем окно авторизации точно как VK
        window.open(data.authUrl, 'instagram-auth', 'width=600,height=600');
        
        toast({
          title: "OAuth авторизация",
          description: "Откроется окно для авторизации Instagram"
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

  const handleCompleteSetup = () => {
    setCurrentStep(3);
    toast({
      title: "Успех",
      description: "Instagram настроен успешно!",
      variant: "default"
    });
    setTimeout(() => {
      onComplete();
    }, 2000);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Сначала создайте Facebook приложение и введите App ID и App Secret.
              </AlertDescription>
            </Alert>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Facebook className="h-5 w-5" />
                  Facebook App данные
                </CardTitle>
                <CardDescription>
                  Введите App ID и App Secret вашего Facebook приложения
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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

                <Button 
                  onClick={handleGetToken}
                  disabled={isProcessing || !formData.appId || !formData.appSecret}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Запуск авторизации...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Получить токен Instagram
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Окно авторизации Instagram должно открыться в новой вкладке. Пройдите авторизацию и закройте окно.
              </AlertDescription>
            </Alert>

            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Ожидание завершения авторизации...</p>
            </div>

            <Button 
              onClick={handleCompleteSetup}
              className="w-full"
            >
              Авторизация завершена
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        );

      case 3:
        return (
          <div className="text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h3 className="text-xl font-semibold">Настройка Instagram завершена!</h3>
            <p className="text-gray-600">
              Instagram интеграция успешно настроена. Теперь вы можете публиковать контент в Instagram.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Настройка Instagram интеграции</h2>
        <div className="flex space-x-2">
          {steps.map((step, index) => (
            <div key={index} className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${currentStep > index + 1 ? 'bg-green-500 text-white' : 
                  currentStep === index + 1 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'}
              `}>
                {currentStep > index + 1 ? <CheckCircle className="h-4 w-4" /> : index + 1}
              </div>
              {index < steps.length - 1 && (
                <div className={`w-16 h-1 mx-2 ${currentStep > index + 1 ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <h3 className="font-semibold">{steps[currentStep - 1]?.title}</h3>
          <p className="text-sm text-gray-600">{steps[currentStep - 1]?.description}</p>
        </div>
      </div>

      {renderStep()}

      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        {currentStep === 3 && (
          <Button onClick={onComplete}>
            Завершить
          </Button>
        )}
      </div>
    </div>
  );
};

export default InstagramSetupWizard;