import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ErrorHandlingTest() {
  const [results, setResults] = useState<string[]>([]);

  const testError = async (errorType: string) => {
    try {
      const response = await fetch(`/api/test/error-${errorType}`);
      if (!response.ok) {
        throw new Error(`${response.status} (${response.statusText})`);
      }
      const data = await response.json();
      setResults(prev => [...prev, `✅ ${errorType}: ${JSON.stringify(data)}`]);
    } catch (error: any) {
      setResults(prev => [...prev, `❌ ${errorType}: ${error.message}`]);
      console.error(`Test ${errorType} error:`, error);
    }
  };

  const testImgurError = async () => {
    try {
      // Симулируем запрос к Imgur с ошибкой 429
      const error = new Error('429 (Too Many Requests)');
      (error as any).status = 429;
      (error as any).response = { status: 429 };
      (error as any).config = { url: 'https://i.imgur.com/babDRlG.mp4' };
      
      throw error;
    } catch (error: any) {
      setResults(prev => [...prev, `❌ Imgur 429: ${error.message}`]);
      console.error('Imgur 429 error:', error);
    }
  };

  const clearResults = () => {
    setResults([]);
  };

  return (
    <div className="container mx-auto py-6">
      <Card>
        <CardHeader>
          <CardTitle>Тест обработки ошибок в Production</CardTitle>
          <CardDescription>
            Проверка того, какие ошибки показываются пользователям в production режиме.
            В development видны все ошибки, в production только критические.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => testError('401')} variant="outline">
              Тест 401 Unauthorized
            </Button>
            <Button onClick={() => testError('403')} variant="outline">
              Тест 403 Forbidden
            </Button>
            <Button onClick={() => testError('404')} variant="outline">
              Тест 404 Not Found
            </Button>
            <Button onClick={() => testError('429')} variant="outline">
              Тест 429 Too Many Requests
            </Button>
            <Button onClick={() => testError('500')} variant="outline">
              Тест 500 Server Error
            </Button>
            <Button onClick={testImgurError} variant="outline">
              Тест Imgur 429
            </Button>
          </div>
          
          <div className="flex gap-2">
            <Button onClick={clearResults} variant="secondary">
              Очистить результаты
            </Button>
            <Badge variant="secondary">
              Среда: {import.meta.env.MODE}
            </Badge>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Результаты тестов:</h3>
            <div className="bg-gray-100 p-4 rounded-md min-h-[200px] font-mono text-sm">
              {results.length === 0 ? (
                <div className="text-gray-500">Нажмите на кнопки выше для тестирования ошибок</div>
              ) : (
                results.map((result, index) => (
                  <div key={index} className="mb-1">
                    {result}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Ожидаемое поведение:</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <div><strong>Development:</strong> Все ошибки видны в консоли браузера</div>
              <div><strong>Production:</strong> HTTP ошибки (401, 403, 404, 429, 500) скрыты</div>
              <div><strong>Production:</strong> Видны только ошибки с ключевыми словами: "КРИТИЧЕСКАЯ ОШИБКА", "обратитесь к администрации"</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}