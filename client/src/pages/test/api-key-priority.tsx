import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/lib/store';

/**
 * Тестовая страница для проверки приоритизации API ключей в системе
 * Позволяет проверить, корректно ли работает система приоритетов:
 * 1. Ключи пользователя имеют приоритет над системными ключами
 * 2. Системные ключи используются только если не найдены пользовательские
 */
export default function ApiKeyPriorityTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuthStore();

  async function testPriority() {
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.get('/api/test/api-keys/priority', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      
      setResult(response.data);
    } catch (err: any) {
      console.error('Error testing API key priority:', err);
      setError(err.response?.data?.message || err.message || 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  // Вспомогательная функция для определения статуса
  function getStatusBadge(result: any) {
    if (!result) return null;
    
    if (result.data?.prioritization_working) {
      return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="w-4 h-4 mr-1" /> Приоритизация работает корректно</Badge>;
    } else {
      return <Badge className="bg-yellow-500 hover:bg-yellow-600"><AlertTriangle className="w-4 h-4 mr-1" /> Приоритизация не работает</Badge>;
    }
  }
  
  // Статус авторизации
  function getAuthStatus() {
    if (token) {
      return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="w-4 h-4 mr-1" /> Пользователь авторизован</Badge>;
    } else {
      return <Badge className="bg-red-500 hover:bg-red-600"><AlertCircle className="w-4 h-4 mr-1" /> Пользователь не авторизован</Badge>;
    }
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Тест приоритизации API ключей</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Проверка работы системы приоритизации API ключей</CardTitle>
          <CardDescription>
            Проверяет, корректно ли работает новая система приоритизации API ключей:<br />
            1. Пользовательские ключи в Directus имеют приоритет<br />
            2. В случае отсутствия пользовательских ключей используются системные ключи<br />
            3. В последнюю очередь используются ключи из переменных окружения
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <p className="mb-2 font-medium">Статус авторизации:</p>
            {getAuthStatus()}
            <p className="mt-2 text-sm text-gray-500">
              {token 
                ? 'Для тестирования системы приоритизации требуется авторизация.'
                : 'Для полноценного тестирования необходимо авторизоваться в системе!'}
            </p>
          </div>
          
          {result && (
            <>
              <Separator className="my-4" />
              <div className="mt-4">
                <p className="mb-2 font-medium">Результат проверки:</p>
                {getStatusBadge(result)}
                
                <div className="mt-4 p-4 bg-gray-100 rounded-md">
                  <p className="font-medium mb-2">Подробности:</p>
                  <ul className="space-y-2 text-sm">
                    <li>
                      <span className="font-medium">Выбранный API ключ: </span>
                      <code>{result.data?.selected_api_key || 'Не получен'}</code>
                    </li>
                    <li>
                      <span className="font-medium">Источник: </span>
                      <code>{result.data?.source || 'Неизвестно'}</code>
                    </li>
                    <li>
                      <span className="font-medium">Пользовательский ключ: </span>
                      <code>{result.data?.sources?.user_key || 'Отсутствует'}</code>
                      <p className="text-xs text-gray-500 mt-1">Статус: {result.data?.sources?.user_key_status}</p>
                    </li>
                    <li>
                      <span className="font-medium">Ключ в переменных окружения: </span>
                      <code>{result.data?.sources?.env_key_present ? 'Присутствует' : 'Отсутствует'}</code>
                    </li>
                  </ul>
                </div>
                
                <div className="mt-4 p-4 bg-blue-50 rounded-md">
                  <p className="text-blue-700 flex items-center">
                    <Info className="w-4 h-4 mr-2" /> 
                    {result.message}
                  </p>
                </div>
              </div>
            </>
          )}
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 rounded-md">
              <p className="text-red-700 flex items-center">
                <AlertCircle className="w-4 h-4 mr-2" /> 
                {error}
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            onClick={testPriority} 
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Проверка...' : 'Проверить приоритизацию API ключей'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}