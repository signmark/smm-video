import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { ImageGenerationTester } from "@/components/ImageGenerationTester";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle } from "lucide-react";

export default function ImageGenerationTest() {
  const { user } = useAuth() || {};
  const { toast } = useToast();
  const [apiKeyStatus, setApiKeyStatus] = useState<'checking' | 'ok' | 'missing' | 'error'>('checking');

  useEffect(() => {
    // Проверяем статус API ключа напрямую через серверный эндпоинт
    const checkApiKey = async () => {
      try {
        // Делаем простой запрос для проверки доступности API ключа
        const response = await fetch('/api/settings/fal_ai');
        
        if (!response.ok) {
          console.error('API ключ FAL.AI не найден на сервере');
          setApiKeyStatus('missing');
          return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.data?.api_key) {
          console.error('API ключ FAL.AI не найден в ответе сервера');
          setApiKeyStatus('missing');
          return;
        }
        
        // Получили API ключ, считаем его валидным
        console.log('FAL.AI API ключ найден на сервере');
        setApiKeyStatus('ok');
      } catch (error) {
        console.error('Ошибка при проверке API ключа:', error);
        setApiKeyStatus('error');
      }
    };

    checkApiKey();
  }, []);

  const handleSettingsOpen = () => {
    // Перенаправление на страницу настроек
    toast({
      title: "Переход в настройки",
      description: "Для тестирования требуется добавить API ключ FAL.AI",
    });
    window.location.href = "/settings";
  };

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-2xl font-bold mb-6">Тестирование генерации изображений через FAL.AI</h1>
        
        {apiKeyStatus === 'checking' && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Проверка API ключа...</AlertTitle>
            <AlertDescription>
              Подождите, идет проверка наличия настроенного API ключа FAL.AI
            </AlertDescription>
          </Alert>
        )}
        
        {apiKeyStatus === 'error' && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Ошибка проверки API ключа</AlertTitle>
            <AlertDescription>
              Произошла ошибка при проверке наличия API ключа FAL.AI. Пожалуйста, попробуйте позже.
            </AlertDescription>
          </Alert>
        )}
        
        {apiKeyStatus === 'missing' && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>API ключ FAL.AI не настроен</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>Для тестирования генерации изображений требуется API ключ FAL.AI. Пожалуйста, добавьте его в настройках.</p>
              <Button variant="outline" onClick={handleSettingsOpen}>
                Перейти в настройки
              </Button>
            </AlertDescription>
          </Alert>
        )}
        
        {apiKeyStatus === 'ok' && (
          <Alert variant="default" className="mb-6 border-green-500">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertTitle>API ключ FAL.AI настроен</AlertTitle>
            <AlertDescription>
              Ключ FAL.AI успешно установлен. Вы можете использовать тестер ниже.
            </AlertDescription>
          </Alert>
        )}
        
        <ImageGenerationTester />
        
        <div className="mt-8 p-4 bg-muted rounded-md text-sm">
          <h2 className="font-semibold mb-2">Информация о работе с API FAL.AI:</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Таймаут API запроса установлен на 5 минут (300 секунд)</li>
            <li>В случае ошибки соединения предусмотрен механизм повторных попыток</li>
            <li>Поддерживается генерация изображений с разными параметрами</li>
            <li>Оптимизировано для надежной работы с большими изображениями</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}