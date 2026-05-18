import React, { useState } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LoaderCircle } from 'lucide-react';

/**
 * Страница для тестирования функции исправления HTML-тегов
 */
export default function HtmlTagsTestPage() {
  const [inputText, setInputText] = useState('<b>Пример текста с <i>незакрытыми тегами');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Функция для отправки запроса к API
  const testHtmlTagsFixer = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post('/api/test/fix-html-tags', { text: inputText });
      setResult(response.data);
    } catch (err: any) {
      console.error('Ошибка при тестировании исправления HTML-тегов:', err);
      setError(err.response?.data?.error || err.message || 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  };

  // Функция для проверки закрытия тегов
  const checkTagsClosed = (text: string): boolean => {
    const stack: string[] = [];
    const regex = /<\/?([a-z][a-z0-9]*)\b[^>]*>|<!--[\s\S]*?-->/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Пропускаем комментарии
      if (match[0].startsWith('<!--')) continue;
      
      // Определяем, открывающий или закрывающий тег
      if (!match[0].startsWith('</')) {
        // Это открывающий тег, добавляем в стек
        const tagName = match[1].toLowerCase();
        
        // Пропускаем самозакрывающиеся теги (например <img />)
        if (!match[0].endsWith('/>')) {
          stack.push(tagName);
        }
      } else {
        // Это закрывающий тег, проверяем соответствие с вершиной стека
        const tagName = match[1].toLowerCase();
        
        // Стек пуст или теги не совпадают
        if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
          return false;
        }
        
        // Удаляем тег из стека, так как он закрыт
        stack.pop();
      }
    }
    
    // Если стек пуст, все теги закрыты
    return stack.length === 0;
  };

  // Примеры тестовых текстов с незакрытыми тегами
  const examples = [
    {
      name: 'Простой незакрытый тег',
      text: 'Текст с <b>жирным шрифтом, который не закрыт'
    },
    {
      name: 'Несколько незакрытых тегов',
      text: 'Текст с <b>жирным и <i>курсивным шрифтом, которые не закрыты'
    },
    {
      name: 'Вложенные незакрытые теги',
      text: '<b>Жирный <i>курсив <u>подчеркнутый текст'
    },
    {
      name: 'Теги с неправильной вложенностью',
      text: '<b>Жирный <i>курсивный</b> все еще курсивный?'
    },
    {
      name: 'Сложный текст с разными тегами',
      text: '<b>Заголовок статьи</b>\n\n<i>Вводный текст с курсивом\n\nОсновной текст статьи с <u>подчеркнутыми терминами и <b>важными моментами, выделенными жирным'
    }
  ];

  const isOriginalClosed = result ? checkTagsClosed(result.originalText) : null;
  const isBasicFixClosed = result ? checkTagsClosed(result.fixedWithBasic) : null;
  const isAggressiveFixClosed = result ? checkTagsClosed(result.fixedWithAggressive) : null;
  const isPreparedClosed = result ? checkTagsClosed(result.preparedForTelegram) : null;

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Тестирование исправления HTML-тегов</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Введите текст с HTML-тегами</CardTitle>
            <CardDescription>
              Вставьте текст с незакрытыми HTML-тегами для проверки работы функции исправления
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={10}
              placeholder="Введите текст с HTML-тегами..."
              className="w-full resize-y font-mono"
            />
            <div className="mt-4">
              <h3 className="font-semibold mb-2">Примеры текстов для тестирования:</h3>
              <div className="flex flex-wrap gap-2">
                {examples.map((example, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => setInputText(example.text)}
                    className="text-xs"
                  >
                    {example.name}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={testHtmlTagsFixer} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Проверка...
                </>
              ) : (
                'Проверить и исправить HTML-теги'
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Ошибка</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {result && (
            <Card>
              <CardHeader>
                <CardTitle>Результаты проверки</CardTitle>
                <CardDescription>
                  Сравнение различных методов исправления незакрытых HTML-тегов
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 mb-4">
                  <div className="rounded-md border p-4 text-sm">
                    <h3 className="font-semibold">Проверка закрытия всех тегов:</h3>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center">
                        <span className={`inline-block w-4 h-4 rounded-full mr-2 ${isOriginalClosed ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        <span>Исходный текст: {isOriginalClosed ? 'Все теги закрыты' : 'Есть незакрытые теги'}</span>
                      </div>
                      <div className="flex items-center">
                        <span className={`inline-block w-4 h-4 rounded-full mr-2 ${isBasicFixClosed ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        <span>Базовое исправление: {isBasicFixClosed ? 'Все теги закрыты' : 'Есть незакрытые теги'}</span>
                      </div>
                      <div className="flex items-center">
                        <span className={`inline-block w-4 h-4 rounded-full mr-2 ${isAggressiveFixClosed ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        <span>Агрессивное исправление: {isAggressiveFixClosed ? 'Все теги закрыты' : 'Есть незакрытые теги'}</span>
                      </div>
                      <div className="flex items-center">
                        <span className={`inline-block w-4 h-4 rounded-full mr-2 ${isPreparedClosed ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        <span>Подготовлено для Telegram: {isPreparedClosed ? 'Все теги закрыты' : 'Есть незакрытые теги'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <Tabs defaultValue="original">
                  <TabsList className="mb-4 w-full">
                    <TabsTrigger value="original" className="flex-1">Исходный</TabsTrigger>
                    <TabsTrigger value="basic" className="flex-1">Базовое исправление</TabsTrigger>
                    <TabsTrigger value="aggressive" className="flex-1">Агрессивное исправление</TabsTrigger>
                    <TabsTrigger value="telegram" className="flex-1">Для Telegram</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="original">
                    <pre className="bg-slate-100 dark:bg-slate-900 p-4 rounded-md overflow-auto text-sm font-mono whitespace-pre-wrap">
                      {result.originalText}
                    </pre>
                    <div className="mt-2 text-xs text-slate-500">
                      Длина: {result.comparison.originalLength} символов
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="basic">
                    <pre className="bg-slate-100 dark:bg-slate-900 p-4 rounded-md overflow-auto text-sm font-mono whitespace-pre-wrap">
                      {result.fixedWithBasic}
                    </pre>
                    <div className="mt-2 text-xs text-slate-500">
                      Длина: {result.comparison.basicFixLength} символов
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="aggressive">
                    <pre className="bg-slate-100 dark:bg-slate-900 p-4 rounded-md overflow-auto text-sm font-mono whitespace-pre-wrap">
                      {result.fixedWithAggressive}
                    </pre>
                    <div className="mt-2 text-xs text-slate-500">
                      Длина: {result.comparison.aggressiveFixLength} символов
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="telegram">
                    <pre className="bg-slate-100 dark:bg-slate-900 p-4 rounded-md overflow-auto text-sm font-mono whitespace-pre-wrap">
                      {result.preparedForTelegram}
                    </pre>
                    <div className="mt-2 text-xs text-slate-500">
                      Длина: {result.comparison.preparedForTelegramLength} символов
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}