import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Компонент для тестирования и отладки API ключей
 */
export default function ApiKeysTest() {
  const [loading, setLoading] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [falApiResults, setFalApiResults] = useState<any>(null);
  const [falApiError, setFalApiError] = useState<string | null>(null);
  const { toast } = useToast();

  // Функция для тестирования всех API ключей
  const testAllApiKeys = async () => {
    setLoading(true);
    setTestResults(null);
    setTestError(null);
    
    try {
      const response = await api.get('/debug/api-keys');
      setTestResults(response.data.data);
      toast({
        title: 'Успешно!',
        description: 'Получена информация о API ключах',
        variant: 'default',
      });
    } catch (err: any) {
      console.error('Ошибка при тестировании API ключей:', err);
      setTestError(err.message || 'Ошибка при тестировании API ключей');
      toast({
        title: 'Ошибка',
        description: `Не удалось проверить API ключи: ${err.message}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Функция для тестирования FAL.AI API
  const testFalApiKey = async (format: string = 'with-prefix') => {
    setLoading(true);
    setFalApiResults(null);
    setFalApiError(null);
    
    try {
      const response = await api.get(`/api/test-fal-ai-formats?format=${format}`);
      setFalApiResults(response.data);
      toast({
        title: 'Успешно!',
        description: `Тест FAL.AI API с форматом "${format}" завершен успешно`,
        variant: 'default',
      });
    } catch (err: any) {
      console.error('Ошибка при тестировании FAL.AI API:', err);
      setFalApiError(err.response?.data?.error || err.message || 'Ошибка при тестировании FAL.AI API');
      setFalApiResults(err.response?.data);
      toast({
        title: 'Ошибка',
        description: `Не удалось протестировать FAL.AI API: ${err.message}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Запускаем тестирование при монтировании компонента
  useEffect(() => {
    testAllApiKeys();
  }, []);

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Тестирование API ключей</h1>
      
      <Tabs defaultValue="all-keys">
        <TabsList className="mb-4">
          <TabsTrigger value="all-keys">Все ключи</TabsTrigger>
          <TabsTrigger value="fal-api">FAL.AI API</TabsTrigger>
        </TabsList>
        
        <TabsContent value="all-keys">
          <Card>
            <CardHeader>
              <CardTitle>Проверка всех API ключей</CardTitle>
              <CardDescription>
                Проверяет наличие и доступность всех API ключей в системе
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Button 
                  onClick={testAllApiKeys} 
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Проверка...
                    </>
                  ) : (
                    'Проверить все API ключи'
                  )}
                </Button>
              </div>
              
              {testError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md mb-4">
                  <strong>Ошибка:</strong> {testError}
                </div>
              )}
              
              {testResults && (
                <div className="mt-4">
                  <h3 className="text-lg font-medium mb-2">Результаты проверки:</h3>
                  
                  <div className="mb-4">
                    <h4 className="text-md font-medium mb-1">Пользователь:</h4>
                    <code className="bg-gray-100 p-1 rounded">{testResults.userId}</code>
                  </div>
                  
                  <div className="mb-4">
                    <h4 className="text-md font-medium mb-1">API ключи в базе данных:</h4>
                    {testResults.rawApiKeys.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-gray-200 p-2">ID</th>
                              <th className="border border-gray-200 p-2">Сервис</th>
                              <th className="border border-gray-200 p-2">Ключ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {testResults.rawApiKeys.map((key: any) => (
                              <tr key={key.id}>
                                <td className="border border-gray-200 p-2">{key.id}</td>
                                <td className="border border-gray-200 p-2">{key.service || 'Не указан'}</td>
                                <td className="border border-gray-200 p-2">
                                  {key.hasKey ? (
                                    <span className="text-green-500 font-medium">Есть ({key.keyLength} символов)</span>
                                  ) : (
                                    <span className="text-red-500 font-medium">Отсутствует</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-yellow-600">Нет API ключей в базе данных</p>
                    )}
                  </div>
                  
                  <div className="mb-4">
                    <h4 className="text-md font-medium mb-1">Результаты проверки по сервисам:</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="border border-gray-200 p-2">Сервис</th>
                            <th className="border border-gray-200 p-2">Статус</th>
                            <th className="border border-gray-200 p-2">Информация</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testResults.serviceResults.map((result: any) => (
                            <tr key={result.service}>
                              <td className="border border-gray-200 p-2 font-medium">
                                {result.service}
                              </td>
                              <td className="border border-gray-200 p-2">
                                {result.keyExists ? (
                                  <span className="text-green-500 font-medium">Доступен</span>
                                ) : (
                                  <span className="text-red-500 font-medium">Не найден</span>
                                )}
                              </td>
                              <td className="border border-gray-200 p-2">
                                {result.keyExists ? (
                                  <div>
                                    <p>Длина: {result.keyLength} символов</p>
                                    {result.keyPrefix && <p>Префикс: {result.keyPrefix}</p>}
                                  </div>
                                ) : (
                                  <div>
                                    <p className="text-red-500">{result.error || 'Ключ не найден'}</p>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="fal-api">
          <Card>
            <CardHeader>
              <CardTitle>Тестирование FAL.AI API</CardTitle>
              <CardDescription>
                Проверка форматов API ключа для FAL.AI
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex space-x-2">
                <Button 
                  onClick={() => testFalApiKey('with-prefix')} 
                  disabled={loading}
                  variant="outline"
                >
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  С префиксом "Key"
                </Button>
                <Button 
                  onClick={() => testFalApiKey('without-prefix')} 
                  disabled={loading}
                  variant="outline"
                >
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Без префикса
                </Button>
                <Button 
                  onClick={() => testFalApiKey('bearer')} 
                  disabled={loading}
                  variant="outline"
                >
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  C префиксом "Bearer"
                </Button>
                <Button 
                  onClick={() => testFalApiKey('original')} 
                  disabled={loading}
                  variant="outline"
                >
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Оригинальный формат
                </Button>
              </div>
              
              {falApiError && !falApiResults?.success && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md mb-4">
                  <strong>Ошибка:</strong> {falApiError}
                </div>
              )}
              
              {falApiResults && (
                <div className="mt-4">
                  <h3 className="text-lg font-medium mb-2">Результаты тестирования:</h3>
                  
                  <div className="bg-gray-50 p-4 rounded-md border">
                    <p>
                      <strong>Статус:</strong>{' '}
                      {falApiResults.success ? (
                        <span className="text-green-500 font-medium">Успешно</span>
                      ) : (
                        <span className="text-red-500 font-medium">Ошибка</span>
                      )}
                    </p>
                    
                    <p>
                      <strong>Формат ключа:</strong> {falApiResults.format}
                    </p>
                    
                    {falApiResults.success && (
                      <>
                        <p>
                          <strong>HTTP Статус:</strong> {falApiResults.status}
                        </p>
                        <p>
                          <strong>Данные:</strong> {falApiResults.dataKeys?.join(', ')}
                        </p>
                      </>
                    )}
                    
                    {!falApiResults.success && falApiResults.details && (
                      <div className="mt-2">
                        <p><strong>Детали ошибки:</strong></p>
                        <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(falApiResults.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}