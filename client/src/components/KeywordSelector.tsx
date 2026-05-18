import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuthStore } from '@/lib/store';
import { Checkbox } from '@/components/ui/checkbox';
import { useQueryClient } from '@tanstack/react-query';

interface Keyword {
  keyword: string;
  frequency?: number;
  competition?: number;
  source?: string;
}

interface KeywordSelectorProps {
  onSelect: (keywords: string[] | Keyword[]) => void;
  selectedKeywords?: string[];
  campaignId?: string;
  label?: string;
  placeholder?: string;
}

export function KeywordSelector({
  onSelect,
  selectedKeywords = [],
  campaignId,
  label = 'Ключевые слова',
  placeholder = 'Введите ключевое слово или фразу',
}: KeywordSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>(selectedKeywords || []);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const { toast } = useToast();
  const [existingKeywords, setExistingKeywords] = useState<string[]>([]);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const { getAuthToken } = useAuthStore();
  const queryClient = useQueryClient();

  const loadExistingKeywords = async () => {
    if (!campaignId) return;
    
    setIsLoadingExisting(true);
    try {
      const authToken = getAuthToken();
      const response = await fetch(`/api/keywords/${campaignId}`, {
        headers: {
          'Authorization': authToken ? `Bearer ${authToken}` : ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Ошибка при загрузке ключевых слов: ${response.status}`);
      }
      
      const data = await response.json();
      const keywords = data.map((item: any) => item.keyword);
      setExistingKeywords(keywords);
      setSelectedItems(keywords);
      
      // Удаляем автоматический вызов onSelect при загрузке
      // Теперь пользователь должен явно нажать кнопку "Сохранить ключевые слова"
    } catch (error) {
      console.error('Error loading keywords:', error);
    } finally {
      setIsLoadingExisting(false);
    }
  };

  useEffect(() => {
    if (campaignId) {

      loadExistingKeywords();
    }
  }, [campaignId]);

  // Инициализируем выбранные элементы только при первоначальной загрузке компонента
  // или при изменении другой кампании, но не при каждом изменении selectedKeywords
  useEffect(() => {
    if (selectedKeywords && selectedKeywords.length > 0) {
      // Проверяем, действительно ли это новый массив, а не тот же самый
      setExistingKeywords(selectedKeywords);
      setSelectedItems(selectedKeywords);
    }
  }, []);

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    
    setIsLoading(true);
    setErrorMessage('');
    setKeywords([]);
    
    try {
      // Получаем токен авторизации из localStorage
      const authToken = localStorage.getItem('auth_token');
      
      // Используем новый универсальный API endpoint для поиска ключевых слов
      const response = await fetch('/api/keywords/search', {
        method: 'POST',
        headers: {
          'Authorization': authToken ? `Bearer ${authToken}` : '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          keyword: searchTerm.trim()
        })
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          setShowApiKeyDialog(true);
          setIsLoading(false);
          return;
        }
        throw new Error(`Ошибка при поиске ключевых слов: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data?.data?.keywords?.length) {
        toast({ 
          title: "Результаты",
          description: "Не найдено ключевых слов" 
        });
        setIsLoading(false);
        return;
      }

      // Форматируем результаты и преобразуем данные
      const formattedResults = data.data.keywords.map((kw: any) => ({
        keyword: kw.keyword,
        frequency: kw.trend || kw.frequency || 0, // Используем trend из нового API
        competition: kw.competition || 0,
      }));

      // Удаляем дубликаты по ключевому слову, оставляя версию с наибольшей частотой
      const keywordMap = new Map<string, typeof formattedResults[0]>();
      
      formattedResults.forEach(item => {
        const lowerKeyword = item.keyword.toLowerCase();
        const existing = keywordMap.get(lowerKeyword);
        
        // Если такого ключевого слова еще нет или текущая частота выше
        if (!existing || item.frequency > existing.frequency) {
          keywordMap.set(lowerKeyword, item);
        }
      });
      
      // Преобразуем Map обратно в массив
      const uniqueResults = Array.from(keywordMap.values());

      setKeywords(uniqueResults);
      
      toast({ 
        title: "Успешно",
        description: `Найдено ${uniqueResults.length} ключевых слов` 
      });
      
    } catch (error) {
      console.error('Error searching keywords:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Произошла ошибка при поиске ключевых слов');
      
      toast({
        title: 'Ошибка поиска',
        description: error instanceof Error ? error.message : 'Произошла ошибка при поиске ключевых слов',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  // Функция для выбора ключевого слова из результатов поиска
  // Теперь просто отмечает или снимает чекбокс без сохранения в БД
  const handleSelect = (keyword: string) => {
    // Проверяем, существует ли уже это ключевое слово
    if (existingKeywords.includes(keyword)) {
      // Если ключевое слово уже существует в кампании, просто показываем информационное сообщение
      toast({
        variant: "default",
        description: `Ключевое слово "${keyword}" уже добавлено, но вы можете выбрать другие`
      });
      // Возвращаемся без ошибки, но не даем выбрать это слово снова
      return;
    }
    
    // Проверяем, выбрано ли уже это ключевое слово
    if (selectedItems.includes(keyword)) {
      // Если уже выбрано, убираем его из списка выбранных (снимаем чекбокс)
      setSelectedItems(prev => prev.filter(item => item !== keyword));
      
      // Убираем toast при снятии чекбокса для лучшего UX
    } else {
      // Если не выбрано, добавляем в список выбранных (отмечаем чекбокс)
      setSelectedItems(prev => [...prev, keyword]);
      
      // Убираем toast при отметке чекбокса для лучшего UX
    }
    
    // Не вызываем onSelect, сохранение будет происходить только по кнопке "Сохранить выбранные"
  };
  
  // Функция для сохранения всех выбранных ключевых слов с их метриками
  const handleSaveSelected = () => {
    if (keywords.length > 0) {
      // Получаем все выбранные ключевые слова с метриками
      const allSelectedKeywords = keywords
        .filter(item => selectedItems.includes(item.keyword));
      
      // Разделяем на новые и существующие
      const newKeywords = allSelectedKeywords
        .filter(item => !existingKeywords.includes(item.keyword)); 
      
      const duplicateKeywords = allSelectedKeywords
        .filter(item => existingKeywords.includes(item.keyword));
      
      // Получаем только строковые значения ключевых слов для обновления UI
      const newKeywordStrings = newKeywords.map(item => item.keyword);
      



      
      // Формируем информативное сообщение
      let message = '';
      if (newKeywords.length > 0) {
        message += `Добавлено ${newKeywords.length} новых ключевых слов. `;
      }
      if (duplicateKeywords.length > 0) {
        message += `Пропущено ${duplicateKeywords.length} дубликатов. `;
      }
      
      // Оптимистично обновляем локальные состояния
      if (newKeywords.length > 0) {
        setExistingKeywords(prev => [...prev, ...newKeywordStrings]);
        
        // Отправляем полные данные родительскому компоненту
        // Передаем объекты с метриками вместо простых строк
        onSelect(newKeywords);
        
        // Показываем сообщение о результате
        toast({
          title: newKeywords.length > 0 ? "Успешно" : "Информация",
          description: message || `Обработано ${allSelectedKeywords.length} ключевых слов`,
          variant: "default"
        });
      } else if (duplicateKeywords.length > 0) {
        // Все выбранные ключевые слова уже существуют
        toast({
          description: "Все выбранные ключевые слова уже добавлены",
          variant: "default"
        });
      } else {
        toast({
          description: "Не выбрано ни одного ключевого слова",
          variant: "default"
        });
      }
      
      // Очищаем результаты после сохранения
      setKeywords([]);
      setSearchTerm('');
    }
  };
  
  // Функция для удаления ключевого слова при клике на бейдж (для уже выбранных слов)
  // с мгновенным сохранением на сервере путем отправки только удаляемого ключевого слова
  const handleRemoveKeyword = (keyword: string) => {
    // Проверяем, что ключевое слово есть в существующих (чтобы не пытаться удалить то, чего нет)
    if (!existingKeywords.includes(keyword)) {

      return;
    }
    
    // Логируем действие для отладки

    
    // Оптимистично удаляем ключевое слово из нашего локального состояния
    setSelectedItems(prev => prev.filter(item => item !== keyword));
    
    // Сразу показываем уведомление пользователю
    toast({
      description: `Ключевое слово "${keyword}" удалено`
    });
    
    // Также обновляем существующие ключевые слова (оптимистичное обновление UI)
    setExistingKeywords(prev => prev.filter(k => k !== keyword));
    
    // Отправляем ключевое слово для удаления в родительский компонент
    // Родительский компонент [id].tsx будет обрабатывать это удаление через removeKeyword,
    // который затем инвалидирует оба ключа кеша: ["/api/keywords", campaignId] и ["campaign_keywords", campaignId]
    onSelect([keyword]);
    
    // Инвалидации кеша происходит в родительском компоненте, потому что там есть доступ к queryClient,
    // и там известен campaignId. Здесь мы полагаемся на этот механизм.
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat('ru-RU').format(num);
  };
  
  // Функция для сравнения двух массивов строк (без учета порядка)
  const areArraysEqual = (array1: string[], array2: string[]): boolean => {
    if (array1.length !== array2.length) return false;
    
    // Создаем копии массивов для сортировки, чтобы не изменять оригиналы
    const sorted1 = [...array1].sort();
    const sorted2 = [...array2].sort();
    
    // Сравниваем каждый элемент
    return sorted1.every((item, index) => item === sorted2[index]);
  };

  return (
    <div className="w-full space-y-4">
      <div className="space-y-2">
        <div className="font-medium">{label}</div>
        <div className="flex space-x-2">
          <Input
            type="text"
            placeholder={placeholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={isLoading || !searchTerm.trim()}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Поиск
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-destructive/15 p-3 rounded-md flex items-start space-x-2">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-destructive text-sm">{errorMessage}</div>
        </div>
      )}

      {selectedItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <div className="text-sm font-medium">Выбранные ключевые слова:</div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {selectedItems.map((keyword) => (
              <Badge 
                key={keyword} 
                className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleRemoveKeyword(keyword)}
              >
                {keyword} ×
              </Badge>
            ))}
          </div>
        </div>
      )}

      {keywords.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Результаты поиска:</div>
          <div className="max-h-60 overflow-y-auto border rounded-md">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Ключевое слово</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Частота</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Выбрать</th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {keywords.map((item, index) => {
                  // Проверяем, является ли ключевое слово существующим
                  const isExisting = existingKeywords.includes(item.keyword);
                  // Определяем, отмечен ли чекбокс (выбрано или уже добавлено)
                  const isChecked = selectedItems.includes(item.keyword) || isExisting;
                  
                  return (
                    <tr key={index} className={isChecked ? 'bg-primary/10' : ''}>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        {item.keyword}
                        {isExisting && (
                          <span className="ml-2 text-xs text-muted-foreground">(добавлено)</span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">{formatNumber(item.frequency || 0)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <div className="flex items-center justify-center">
                          <Checkbox 
                            checked={isChecked}
                            onCheckedChange={() => handleSelect(item.keyword)}
                            id={`keyword-${index}`}
                            disabled={isExisting} // Блокируем чекбокс для уже добавленных ключевых слов
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveSelected}
              disabled={!keywords.some(item => selectedItems.includes(item.keyword))}
            >
              Сохранить выбранные
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={showApiKeyDialog} onOpenChange={setShowApiKeyDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Требуется авторизация и API ключ XMLRiver</AlertDialogTitle>
            <AlertDialogDescription>
              Для поиска ключевых слов необходимо:
              <ol className="list-decimal pl-5 mt-2 space-y-1">
                <li>Войти в аккаунт системы (авторизоваться)</li>
                <li>Добавить API ключ XMLRiver в настройках профиля</li>
              </ol>
              <div className="mt-4">
                Вы можете получить API ключ на сайте <a href="https://xmlriver.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">XMLRiver</a>.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowApiKeyDialog(false)}>
              Понятно
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}