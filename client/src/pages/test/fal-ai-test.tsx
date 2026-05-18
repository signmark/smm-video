import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Bug } from "lucide-react";
import { api } from '@/lib/api';

/**
 * Страница для тестирования и отладки интеграции с FAL.AI API
 */
export default function FalAiTest() {
  const [loading, setLoading] = useState(false);
  const [formatLoading, setFormatLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [formatResults, setFormatResults] = useState<any>(null);
  const [debugResults, setDebugResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Проверка всех форматов одновременно
  const runTest = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get('/test-fal-ai');
      setResults(response.data);
    } catch (err: any) {
      setError(err.message || 'Ошибка при тестировании API');
      console.error('Ошибка тестирования:', err);
    } finally {
      setLoading(false);
    }
  };

  // Проверка конкретного формата
  const testFormat = async (format: string) => {
    setFormatLoading(true);
    
    try {
      const response = await api.get(`/test-fal-ai-formats?format=${format}`);
      setFormatResults(response.data);
    } catch (err: any) {
      setFormatResults({
        success: false,
        error: err.message || 'Ошибка при тестировании формата',
        format
      });
      console.error('Ошибка тестирования формата:', err);
    } finally {
      setFormatLoading(false);
    }
  };
  
  // Отладка заголовков API
  const debugHeaders = async () => {
    setDebugLoading(true);
    
    try {
      const response = await api.get('/debug-fal-ai-header');
      setDebugResults(response.data);
      console.log('Отладочная информация о заголовках:', response.data);
    } catch (err: any) {
      console.error('Ошибка при отладке заголовков:', err);
      setDebugResults({
        success: false,
        error: err.message || 'Ошибка при получении отладочной информации'
      });
    } finally {
      setDebugLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Тестирование FAL.AI API</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Bug className="mr-2 h-5 w-5" /> 
            Отладка заголовков API
          </CardTitle>
          <CardDescription>
            Проверка полного формата заголовков для отладки проблем авторизации
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={debugHeaders}
            disabled={debugLoading}
            variant="destructive"
            className="mb-4"
          >
            {debugLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Получение заголовков...
              </>
            ) : 'Показать полные заголовки'}
          </Button>
          
          {debugResults && (
            <div className="mt-4">
              <Alert variant={debugResults.success ? "default" : "destructive"} className="mb-4">
                <AlertTitle>
                  {debugResults.success ? 'Информация о заголовках' : 'Ошибка при получении заголовков'}
                </AlertTitle>
                <AlertDescription>
                  {debugResults.message || 'Получена информация о заголовках авторизации'}
                </AlertDescription>
              </Alert>
              
              {debugResults.keyAnalysis && (
                <div className="mt-4 mb-4 p-4 bg-gray-100 dark:bg-gray-800 rounded border border-red-500">
                  <h4 className="font-medium mb-1">⚠️ ВНИМАНИЕ: Отладочные данные с полными значениями ключа</h4>
                  <pre className="text-xs overflow-auto p-2 bg-gray-200 dark:bg-gray-900 rounded">
                    {JSON.stringify(debugResults.keyAnalysis, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      <Tabs defaultValue="auto">
        <TabsList className="mb-4">
          <TabsTrigger value="auto">Автоматический тест</TabsTrigger>
          <TabsTrigger value="manual">Ручной тест форматов</TabsTrigger>
        </TabsList>
        
        <TabsContent value="auto">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Тест интеграции FAL.AI</CardTitle>
              <CardDescription>
                Автоматически проверяет работу API с различными форматами ключа
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={runTest} 
                disabled={loading}
                className="mb-4"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Тестирование...
                  </>
                ) : 'Запустить тест'}
              </Button>
              
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTitle>Ошибка</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              {results && (
                <div className="mt-4">
                  <h3 className="text-xl font-semibold mb-2">
                    {results.success ? '✅ Тест пройден!' : '❌ Тест не пройден'}
                  </h3>
                  
                  <div className="mb-4 p-4 bg-gray-100 dark:bg-gray-800 rounded">
                    <h4 className="font-medium mb-1">Информация о ключе API:</h4>
                    <pre className="text-xs overflow-auto p-2 bg-gray-200 dark:bg-gray-900 rounded">
                      {JSON.stringify(results.keyInfo, null, 2)}
                    </pre>
                    
                    <h4 className="font-medium mt-4 mb-1">Ключ из переменных окружения:</h4>
                    <pre className="text-xs overflow-auto p-2 bg-gray-200 dark:bg-gray-900 rounded">
                      {JSON.stringify(results.envKeyFormat, null, 2)}
                    </pre>
                  </div>
                  
                  <h4 className="font-semibold mt-4 mb-2">Результаты по форматам:</h4>
                  {results.results?.map((result: any, index: number) => (
                    <div 
                      key={index}
                      className={`p-4 mb-2 rounded ${
                        result.success 
                          ? 'bg-green-100 dark:bg-green-900/20' 
                          : 'bg-red-100 dark:bg-red-900/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium">
                          {result.success ? '✅' : '❌'} Формат: {result.format}
                        </span>
                      </div>
                      
                      {result.success ? (
                        <pre className="text-xs overflow-auto p-2 bg-gray-200 dark:bg-gray-900 rounded">
                          {`Статус: ${result.status}, Данные: ${JSON.stringify(result.data)}`}
                        </pre>
                      ) : (
                        <pre className="text-xs overflow-auto p-2 bg-gray-200 dark:bg-gray-900 rounded">
                          {JSON.stringify(result.error, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle>Тестирование отдельных форматов ключа</CardTitle>
              <CardDescription>
                Ручная проверка конкретного формата ключа API
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 mb-6">
                <Button 
                  onClick={() => testFormat('original')} 
                  disabled={formatLoading}
                  variant="outline"
                >
                  Оригинальный ключ
                </Button>
                <Button 
                  onClick={() => testFormat('with-prefix')} 
                  disabled={formatLoading} 
                  variant="outline"
                >
                  С префиксом "Key "
                </Button>
                <Button 
                  onClick={() => testFormat('without-prefix')} 
                  disabled={formatLoading}
                  variant="outline"
                >
                  Без префикса "Key "
                </Button>
                <Button 
                  onClick={() => testFormat('bearer')} 
                  disabled={formatLoading}
                  variant="outline"
                >
                  С префиксом "Bearer "
                </Button>
              </div>
              
              {formatLoading && (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="ml-2">Тестирование формата...</span>
                </div>
              )}
              
              {formatResults && (
                <div className={`p-4 rounded ${
                  formatResults.success 
                    ? 'bg-green-100 dark:bg-green-900/20' 
                    : 'bg-red-100 dark:bg-red-900/20'
                }`}>
                  <h3 className="font-semibold mb-2">
                    {formatResults.success 
                      ? `✅ Формат "${formatResults.format}" работает корректно` 
                      : `❌ Формат "${formatResults.format}" не работает`}
                  </h3>
                  
                  <pre className="text-xs overflow-auto p-2 bg-gray-200 dark:bg-gray-900 rounded">
                    {JSON.stringify(formatResults.success ? {
                      status: formatResults.status,
                      dataKeys: formatResults.dataKeys
                    } : formatResults.details, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <small className="text-muted-foreground">
                Примечание: эти тесты используют ключ API из переменных окружения
              </small>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}