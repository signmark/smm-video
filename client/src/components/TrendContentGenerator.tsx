import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Copy } from "lucide-react";
// Не используем редактор в этом компоненте
import { apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// Расширенный интерфейс, совместимый с TrendsList
interface TrendTopic {
  id: string;
  title: string;
  sourceId?: string;
  source_id?: string;
  [key: string]: any;
}

/**
 * Извлекает релевантные ключевые слова из трендов,
 * отфильтровывая длинные тексты и форматированные даты
 * @param trends Список трендов
 * @returns Массив ключевых слов
 */
function extractKeywordsFromTrends(trends: TrendTopic[]): string[] {
  const maxKeywordLength = 50; // Максимальная длина ключевого слова
  const datePattern = /\d{2}\.\d{2}\.\d{4}/; // Шаблон для даты
  const postPrefixPattern = /^Пост от \d+/; // Шаблон для префикса "Пост от"
  
  const keywordSet = new Set<string>();
  
  trends.forEach(trend => {
    // Если название тренда слишком длинное, вероятно это целый пост
    if (trend.title.length > maxKeywordLength || 
        datePattern.test(trend.title) || 
        postPrefixPattern.test(trend.title)) {
      
      // Пытаемся извлечь ключевые слова из названия поста
      const words = trend.title
        .split(/[.,;:!?()]+/) // Разбиваем по знакам препинания
        .map(word => word.trim())
        .filter(word => word.length >= 4 && word.length <= 25) // Берем только слова разумной длины
        .filter(word => !word.match(/^\d+$/)) // Исключаем чисто числовые строки
        .filter(word => !datePattern.test(word)) // Исключаем даты
        .slice(0, 5); // Берем только первые 5 слов
      
      words.forEach(word => {
        if (word) keywordSet.add(word);
      });
    } else {
      // Если название короткое - используем его как ключевое слово
      keywordSet.add(trend.title);
    }
  });
  
  return Array.from(keywordSet);
}

const generateContentSchema = z.object({
  prompt: z.string().min(1, "Введите промт для генерации контента"),
  modelType: z.enum(['deepseek', 'qwen', 'gemini-2.5-flash', 'gemini-2.5-pro']).default('deepseek'),
  tone: z.enum(['informative', 'casual', 'professional', 'funny']).default('informative'),
  platforms: z.array(z.string()).min(1, "Выберите хотя бы одну платформу")
});

type GenerateContentForm = z.infer<typeof generateContentSchema>;

interface TrendContentGeneratorProps {
  selectedTopics: TrendTopic[];
  onGenerated?: () => void;
  campaignId?: string;
}

// Типы для результатов генерации контента
interface GenerationResult {
  success?: boolean;
  error?: string;
  content: string;
  service?: string;
}

export function TrendContentGenerator({ selectedTopics, onGenerated, campaignId }: TrendContentGeneratorProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<Date | undefined>(undefined);

  const form = useForm<GenerateContentForm>({
    resolver: zodResolver(generateContentSchema),
    defaultValues: {
      prompt: "",
      modelType: 'deepseek',
      tone: 'informative',
      platforms: ['telegram'],
    }
  });

  /**
   * Функция для очистки HTML-контента от HTML-тегов
   * @param html HTML-контент
   * @returns Очищенный текст
   */
  const stripHtml = (html: string | null | undefined): string => {
    if (!html) return '';
    
    if (typeof html === 'string' && !html.includes('<')) {
      return html;
    }
    
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      return tempDiv.textContent || tempDiv.innerText || '';
    } catch (error) {
      console.error('Ошибка при очистке HTML:', error);
      return typeof html === 'string' ? html : '';
    }
  };

  // Функция для извлечения заголовка из сгенерированного контента
  const extractTitle = (content: string): string => {
    // Пытаемся найти заголовок в теге h1 или h2
    const h1Match = content.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      return stripHtml(h1Match[1]);
    }
    
    const h2Match = content.match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (h2Match && h2Match[1]) {
      return stripHtml(h2Match[1]);
    }
    
    // Если не нашли в тегах, берем первое предложение
    const plainText = stripHtml(content);
    const firstSentence = plainText.split(/[.!?]/).filter(s => s.trim())[0];
    
    if (firstSentence && firstSentence.length > 5) {
      // Если предложение слишком длинное, ограничиваем его
      if (firstSentence.length > 70) {
        return firstSentence.substring(0, 67) + '...';
      }
      return firstSentence;
    }
    
    // В крайнем случае возвращаем общий заголовок
    return "Новая публикация";
  };

  // Мутация для генерации контента через API
  const { mutate: generateContent } = useMutation({
    mutationFn: async (values: GenerateContentForm) => {
      // Формируем контекст из выбранных трендов
      const trendsContext = selectedTopics.map(topic => topic.title).join(", ");
      
      // Очищаем HTML из prompt перед отправкой
      const plainTextPrompt = stripHtml(values.prompt);
      
      // Получаем токен авторизации
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error('Требуется авторизация');
      }
      
      try {

        
        // Вызываем единый API генерации контента
        const response = await fetch('/api/generate-content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            prompt: plainTextPrompt,
            keywords: selectedTopics.map(t => t.title), // Используем заголовки трендов как ключевые слова
            tone: values.tone,
            campaignId: campaignId || selectedTopics[0]?.campaignId || selectedTopics[0]?.campaign_id,
            platform: 'general', // В данном случае используем общую платформу
            service: values.modelType, // Указываем выбранный сервис
            analyzeTrends: true, // Включаем анализ трендов для выявления фишек
            extractKeywords: true, // Указываем необходимость подбора ключевых слов из кампании
            formatOutput: 'html', // Запрашиваем формат вывода в HTML, а не Markdown
            includeFormatting: true // Включаем форматирование с абзацами, заголовками и т.д.
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || error.error || 'Не удалось сгенерировать контент');
        }
        
        const data = await response.json();
        
        // Проверяем на ошибки в ответе
        if (data.success === false) {
          throw new Error(data.error || "Ошибка при генерации контента");
        }
        
        return data as GenerationResult;
      } catch (error: any) {
        console.error('Ошибка при генерации контента:', error);
        throw error;
      }
    },
    onSuccess: (data: GenerationResult) => {
      // Проверяем, является ли ответ успешным
      if (data.success === false) {
        // Отображаем ошибку
        toast({
          title: "Предупреждение",
          description: data.error || "Проблема при генерации контента",
          variant: "destructive"
        });
        return;
      }
      
      // Если это успешный ответ
      if (data.content) {
        // Сохраняем результат генерации
        let formattedContent = data.content;
        
        // Если контент уже содержит теги HTML, мы сохраняем его как есть
        // Но если это простой текст, мы форматируем его в HTML
        if (!formattedContent.includes('<p>') && !formattedContent.includes('<div>') && !formattedContent.includes('<h1>')) {
          // Преобразуем любые оставшиеся признаки Markdown в HTML
          formattedContent = formattedContent
            .split('\n\n').map(paragraph => paragraph.trim())
            .filter(p => p)
            .map(paragraph => {
              // Обрабатываем заголовки
              if (paragraph.startsWith('# ')) {
                return `<h1>${paragraph.substring(2)}</h1>`;
              } else if (paragraph.startsWith('## ')) {
                return `<h2>${paragraph.substring(3)}</h2>`;
              } else if (paragraph.startsWith('### ')) {
                return `<h3>${paragraph.substring(4)}</h3>`;
              // Обрабатываем списки
              } else if (paragraph.includes('\n- ')) {
                const items = paragraph.split('\n- ');
                const title = items.shift();
                return `${title ? `<p>${title}</p>` : ''}<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
              } else if (/^\d+\.\s/.test(paragraph)) {
                const items = paragraph.split(/\n\d+\.\s/);
                const title = items.shift();
                return `${title ? `<p>${title}</p>` : ''}<ol>${items.map(item => `<li>${item}</li>`).join('')}</ol>`;
              } else {
                return `<p>${paragraph}</p>`;
              }
            })
            .join('');
        }
        
        setGeneratedContent(formattedContent);
        
        // Извлекаем заголовок из сгенерированного контента
        const title = extractTitle(formattedContent);
        setGeneratedTitle(title);
        
        toast({
          title: "Успешно",
          description: "Контент сгенерирован"
        });
      } else {
        // Если по какой-то причине content отсутствует
        toast({
          title: "Ошибка данных",
          description: "Сервер вернул неожиданный формат данных",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка при генерации",
        description: error.message || "Не удалось сгенерировать контент",
        variant: "destructive"
      });
    },
    onSettled: () => {
      setIsGenerating(false);
    }
  });

  // Мутация для сохранения сгенерированного контента
  const { mutate: saveContent } = useMutation({
    mutationFn: async () => {
      if (!generatedContent) {
        throw new Error('Нет сгенерированного контента для сохранения');
      }
      
      const values = form.getValues();
      // Публикация только в том случае, если выбраны платформы
      if (values.platforms.length === 0) {
        throw new Error('Выберите хотя бы одну платформу для публикации');
      }
      
      // Всегда сохраняем как черновик (draft), а не в очередь на публикацию
      const status = 'draft';
      
      // Создаем новый контент в системе через API
      return await apiRequest('/api/campaign-content', {
        method: 'POST',
        data: {
          campaignId: campaignId || selectedTopics[0]?.campaignId || selectedTopics[0]?.campaign_id,
          title: generatedTitle,
          content: generatedContent,
          contentType: 'text',
          prompt: form.getValues().prompt,
          platforms: values.platforms,
          scheduledFor: null, // Не устанавливаем дату планирования
          status,
          keywords: extractKeywordsFromTrends(selectedTopics), // Используем только релевантные ключевые слова из трендов
          trendAnalysis: true // Указываем, что контент создан на основе анализа трендов
        }
      });
    },
    onSuccess: () => {
      toast({
        title: "Успешно",
        description: "Контент сохранен как черновик"
      });
      // Сбрасываем форму и состояние
      onGenerated?.();
      setGeneratedContent(null);
      setGeneratedTitle('');
      setScheduledFor(undefined);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка при сохранении",
        description: error.message,
        variant: "destructive"
      });
    },
    onSettled: () => {
      setIsSaving(false);
    }
  });

  const onSubmit = (values: GenerateContentForm) => {
    setIsGenerating(true);
    generateContent(values);
  };
  
  const handleSaveContent = () => {
    if (generatedContent) {
      setIsSaving(true);
      saveContent();
    }
  };

  const platformOptions = [
    { id: 'telegram', label: 'Telegram' },
    { id: 'vk', label: 'ВКонтакте' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'youtube', label: 'YouTube' },
  ];

  const togglePlatform = (platformId: string) => {
    const platforms = form.getValues().platforms;
    if (platforms.includes(platformId)) {
      form.setValue('platforms', platforms.filter(p => p !== platformId));
    } else {
      form.setValue('platforms', [...platforms, platformId]);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Генерация контента по трендам</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          ИИ проанализирует выбранные тренды, выявит их особенности и создаст подходящий контент с учетом заданного промта.
          Сгенерированный контент будет сохранен как черновик со всеми указанными ключевыми словами для дальнейшего редактирования.
        </p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium">Выбранные тренды:</h3>
              <ul className="list-disc list-inside space-y-1">
                {selectedTopics.map(topic => (
                  <li key={topic.id} className="text-sm text-muted-foreground">
                    {topic.title}
                  </li>
                ))}
              </ul>
            </div>

            <FormField
              control={form.control}
              name="prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Промт для генерации</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Введите промт для генерации контента" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <FormField
                control={form.control}
                name="modelType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Модель AI</FormLabel>
                    <Select 
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите модель" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                        <SelectItem value="qwen">Qwen</SelectItem>
                        <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash ⚡</SelectItem>
                        <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                        <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                        <SelectItem value="gemini-3.0-pro">Gemini 3.0 Pro</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Тон сообщения</FormLabel>
                    <Select 
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите тон" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="informative">Информативный</SelectItem>
                        <SelectItem value="casual">Повседневный</SelectItem>
                        <SelectItem value="professional">Профессиональный</SelectItem>
                        <SelectItem value="funny">Юмористический</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={isGenerating} className="w-full">
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Генерация...
                </>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Сгенерировать</>
              )}
            </Button>
            
            {generatedContent && (
              <div className="mt-6 border rounded-lg p-4">
                <h3 className="text-lg font-medium mb-2">Сгенерированный контент:</h3>
                <div className="mb-4 px-4 py-2 bg-muted/20 rounded-md border">
                  <strong>Заголовок: </strong> {generatedTitle}
                </div>
                <div className="prose max-w-none mb-4 bg-muted/50 p-4 rounded-md">
                  <div dangerouslySetInnerHTML={{ __html: generatedContent }} />
                </div>
                
                <div className="mb-4">
                  <h4 className="text-sm font-medium mb-2">Платформы для публикации:</h4>
                  <div className="flex flex-wrap gap-2">
                    {platformOptions.map((platform) => (
                      <Button 
                        key={platform.id}
                        type="button"
                        variant={form.getValues().platforms.includes(platform.id) ? "default" : "outline"}
                        size="sm"
                        onClick={() => togglePlatform(platform.id)}
                      >
                        {platform.label}
                      </Button>
                    ))}
                  </div>
                </div>
                
                <div className="flex justify-end gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => navigator.clipboard.writeText(stripHtml(generatedContent))}
                  >
                    <Copy className="h-4 w-4 mr-2" /> Копировать текст
                  </Button>
                  <Button
                    onClick={handleSaveContent}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Сохранение...
                      </>
                    ) : "Сохранить как черновик"}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}