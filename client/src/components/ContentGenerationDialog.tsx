import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Wand2, Lock, Zap } from "lucide-react";
import { useToast } from '@/hooks/use-toast';
import { usePlan } from '@/hooks/use-plan';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/queryClient';
import RichTextEditor from './RichTextEditor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CampaignKeyword } from "@/types";

interface ContentGenerationDialogProps {
  campaignId: string;
  keywords: CampaignKeyword[];
  onClose: () => void;
}

type ApiService = 'apiservice' | 'deepseek' | 'qwen' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-3.0-pro' | 'gemini-3.5-flash';

// UPDATED: 2025-11-22 15:13 - Added Gemini 3.0 Pro
export function ContentGenerationDialog({ campaignId, keywords, onClose }: ContentGenerationDialogProps) {
  const { toast } = useToast();
  const { isExpired } = usePlan();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [tone, setTone] = useState('informative');
  const [platform, setPlatform] = useState('facebook');
  const [selectedService, setSelectedService] = useState<ApiService>('gemini-3.5-flash');
  const [useCampaignData, setUseCampaignData] = useState(false);

  const { mutate: generateContent, isPending } = useMutation({
    mutationFn: async () => {
      if (!campaignId) {
        throw new Error('Выберите кампанию');
      }

      if (!prompt.trim()) {
        throw new Error('Введите промт для генерации');
      }

      if (selectedKeywords.length === 0) {
        throw new Error('Выберите ключевые слова');
      }

      setIsGenerating(true);

      // Получаем токен авторизации
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error('Требуется авторизация');
      }

      // Выбираем правильный API маршрут в зависимости от выбранного сервиса
      let apiEndpoint = '/api/generate-content'; // Единый маршрут для всех сервисов

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          prompt: prompt,
          keywords: selectedKeywords,
          tone,
          campaignId,
          platform: platform, // Используется для всех сервисов
          service: selectedService, // Указываем выбранный сервис
          useCampaignData: useCampaignData // Использовать данные кампании
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Не удалось сгенерировать контент');
      }

      const data = await response.json();
      const text = data.content;

      if (!text) {
        alert(JSON.stringify(data));
        throw new Error('Сервер вернул пустой контент');
      }

      return {
        content: text,
        service: data.service || selectedService,
        model: data.model || null,
        isFallback: (data.service || '').includes('fallback')
      };
    },
    onSuccess: (data) => {
      // Преобразуем контент в формат, подходящий для редактора

      const content = data.content || '';

      // Человекочитаемое название модели
      const modelLabel = (m: string) => {
        if (!m) return 'Gemini';
        if (m.includes('8b')) return 'Gemini 1.5 Flash 8B';
        if (m.includes('1.5')) return 'Gemini 1.5 Flash';
        if (m.includes('2.5-flash')) return 'Gemini 2.5 Flash';
        if (m.includes('2.5-pro')) return 'Gemini 2.5 Pro';
        if (m.includes('3.0-pro') || m.includes('3-pro')) return 'Gemini 3.0 Pro';
        if (m.includes('3.5') || m.includes('3-flash')) return 'Gemini 3.5 Flash';
        if (m.includes('deepseek')) return 'DeepSeek';
        if (m.includes('qwen')) return 'Qwen';
        return m;
      };

      // Сохраняем модель, которая реально ответила
      setUsedModel(data.model || null);

      // Если сработал fallback — уведомляем и переключаем дропдаун; обычный тост не показываем
      if (data.isFallback && data.model) {
        const fallbackValue = data.model.includes('1.5') ? 'gemini-1.5-flash' : 'gemini-2.5-flash';
        toast({
          title: 'Модель переключена автоматически',
          description: `Выбранная модель временно недоступна (503). Ответ сгенерирован через ${modelLabel(data.model)}.`,
        });
        setSelectedService(fallbackValue as any);
      } else {
        toast({
          title: 'Успешно',
          description: `Контент сгенерирован с помощью ${modelLabel(data.model || '')}`
        });
      }



      // Простая проверка на наличие HTML-тегов
      if (content.includes('<p>') || content.includes('<div>') || content.includes('<h1>')) {

        setGenerationResult(content);
      } else {
        // Форматируем обычный текст в HTML
        try {
          let formattedContent = '';

          // Разбиваем текст на параграфы по двойному переносу строки
          const paragraphs = content.split('\n\n')
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);



          if (paragraphs.length > 0) {
            formattedContent = paragraphs
              .map((paragraph: string) => {
                // Обрабатываем маркдаун-форматирование
                let processed = paragraph
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Полужирный
                  .replace(/\*(.*?)\*/g, '<em>$1</em>'); // Курсив

                // Обрабатываем заголовки
                if (/^#+ /.test(processed)) {
                  const match = processed.match(/^(#+) (.*)/);
                  if (match) {
                    const level = Math.min(match[1].length, 6); // ограничиваем h1-h6
                    return `<h${level}>${match[2]}</h${level}>`;
                  }
                }

                // Оборачиваем в параграф, если это не заголовок
                return `<p>${processed}</p>`;
              })
              .join('');
          } else {
            // Если разбивка на параграфы не сработала, оборачиваем весь текст в один параграф
            formattedContent = `<p>${content
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')}</p>`;
          }


          setGenerationResult(formattedContent);
        } catch (error) {
          console.error('Ошибка при форматировании контента:', error);
          // В случае ошибки форматирования просто используем текст как есть, обернутый в параграф
          setGenerationResult(`<p>${content}</p>`);
        }
      }

      setIsGenerating(false);
    },
    onError: (error: Error) => {
      setIsGenerating(false);
      const msg = error.message || '';
      const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('исчерпано');
      if (is503) {
        toast({
          title: 'Gemini временно перегружен',
          description: 'Все модели Gemini сейчас недоступны (503). Попробуйте через минуту или выберите DeepSeek / Qwen.'
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Ошибка',
          description: msg || 'Ошибка при генерации контента'
        });
      }
    }
  });

  const { mutate: saveContent, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      if (!generationResult) {
        throw new Error('Сначала сгенерируйте контент');
      }

      if (!title.trim()) {
        throw new Error('Введите название для контента');
      }

      // Используем нашу серверную API вместо прямого обращения к Directus
      return await apiRequest('/api/campaign-content', {
        method: 'POST',
        data: {
          campaign_id: campaignId,
          title: title,
          content: generationResult,
          content_type: 'text',
          prompt: prompt,
          keywords: selectedKeywords,
          status: 'draft'
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaign-content', campaignId] });
      toast({
        title: 'Успешно',
        description: 'Контент сохранен'
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: error.message || 'Не удалось сохранить контент'
      });
    }
  });

  const handleKeywordToggle = (keyword: string) => {
    if (selectedKeywords.includes(keyword)) {
      setSelectedKeywords(selectedKeywords.filter(k => k !== keyword));
    } else {
      setSelectedKeywords([...selectedKeywords, keyword]);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => onClose()} modal={true}>
      <DialogContent className={`ai-dialog bg-card text-card-foreground ${!generationResult ? "sm:max-w-[600px] max-h-[95vh] overflow-y-auto" : "sm:max-w-[600px] max-h-[600px] overflow-y-auto"}`}>
        <DialogHeader className="mb-0 pb-1">
          <DialogTitle className="flex items-center gap-2">
            {generationResult ? "Результат генерации контента" : "Генерация контента"}
            {generationResult && usedModel && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {(() => {
                  const m = usedModel;
                  if (m.includes('8b')) return 'Gemini 1.5 Flash 8B';
                  if (m.includes('1.5')) return 'Gemini 1.5 Flash';
                  if (m.includes('2.5-flash')) return 'Gemini 2.5 Flash';
                  if (m.includes('2.5-pro')) return 'Gemini 2.5 Pro';
                  if (m.includes('3.0-pro') || m.includes('3-pro')) return 'Gemini 3.0 Pro';
                  if (m.includes('3.5') || m.includes('3-flash')) return 'Gemini 3.5 Flash';
                  if (m.includes('deepseek')) return 'DeepSeek';
                  if (m.includes('qwen')) return 'Qwen';
                  return m;
                })()}
              </span>
            )}
          </DialogTitle>
          {!generationResult && (
            <DialogDescription className="text-xs">
              Используйте AI для генерации контента на основе ключевых слов и промта
            </DialogDescription>
          )}
        </DialogHeader>

        {isExpired ? (
          <div className="flex flex-col items-center gap-5 py-8 px-4 text-center">
            <div className="rounded-full bg-orange-100 dark:bg-orange-900/30 p-4">
              <Lock className="h-8 w-8 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold text-base mb-1">Подписка истекла</h3>
              <p className="text-sm text-muted-foreground">
                Генерация контента с помощью ИИ недоступна.<br />
                Выберите тариф для продолжения работы.
              </p>
            </div>
            <Button asChild variant="default" className="gap-2">
              <a href="/pricing">
                <Zap className="h-4 w-4" />
                Выбрать тариф
              </a>
            </Button>
          </div>
        ) : !generationResult ? (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="selectedService" className="text-right">
                API Сервис
              </Label>
              <div className="col-span-3">
                <Select
                  value={selectedService}
                  onValueChange={(value) => setSelectedService(value as ApiService)}
                >
                  <SelectTrigger
                    data-testid="ai-model-select"
                    className="w-full !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600"
                  >
                    <SelectValue placeholder="Выберите API Сервис" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999] !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                    <SelectItem data-testid="model-gemini-3.5-flash" value="gemini-3.5-flash" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Gemini 3.5 Flash ⚡</SelectItem>
                    <SelectItem data-testid="model-gemini-3.0-pro" value="gemini-3.0-pro" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Gemini 3.0 Pro</SelectItem>
                    <SelectItem data-testid="model-gemini-2.5-pro" value="gemini-2.5-pro" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Gemini 2.5 Pro</SelectItem>
                    <SelectItem data-testid="model-gemini-2.5-flash" value="gemini-2.5-flash" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Gemini 2.5 Flash</SelectItem>
                    <SelectItem data-testid="model-gemini-1.5-flash" value="gemini-1.5-flash" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Gemini 1.5 Flash</SelectItem>
                    <SelectItem data-testid="model-deepseek" value="deepseek" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">DeepSeek</SelectItem>
                    <SelectItem data-testid="model-qwen" value="qwen" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Qwen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(selectedService === 'deepseek' || selectedService === 'qwen' || selectedService === 'gemini-1.5-flash' || selectedService === 'gemini-2.5-flash' || selectedService === 'gemini-2.5-pro' || selectedService === 'gemini-3.0-pro' || selectedService === 'gemini-3.5-flash') && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="platform" className="text-right">
                  Платформа
                </Label>
                <Select
                  value={platform}
                  onValueChange={setPlatform}
                >
                  <SelectTrigger className="col-span-3 !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                    <SelectValue placeholder="Выберите платформу" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999] !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                    <SelectItem value="facebook" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Facebook</SelectItem>
                    <SelectItem value="instagram" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Instagram</SelectItem>
                    <SelectItem value="telegram" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Telegram</SelectItem>
                    <SelectItem value="vk" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">ВКонтакте</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tone" className="text-right">
                Тон контента
              </Label>
              <Select
                value={tone}
                onValueChange={setTone}
              >
                <SelectTrigger className="col-span-3 !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                  <SelectValue placeholder="Выберите тон контента" />
                </SelectTrigger>
                <SelectContent className="z-[9999] !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                  <SelectItem value="informative" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Информативный</SelectItem>
                  <SelectItem value="friendly" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Дружелюбный</SelectItem>
                  <SelectItem value="professional" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Профессиональный</SelectItem>
                  <SelectItem value="casual" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Повседневный</SelectItem>
                  <SelectItem value="humorous" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">С юмором</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">
                Данные кампании
              </Label>
              <div className="col-span-3 flex items-center space-x-2">
                <Checkbox
                  id="useCampaignData"
                  checked={useCampaignData}
                  onCheckedChange={(checked) => setUseCampaignData(checked === true)}
                  className="!border-gray-300 dark:!border-gray-600 data-[state=checked]:!bg-blue-600 data-[state=checked]:!text-white"
                />
                <Label htmlFor="useCampaignData" className="text-sm cursor-pointer">
                  Использовать данные кампании (сайт, анкета)
                </Label>
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="prompt" className="text-right">
                Промт
              </Label>
              <Textarea
                id="prompt"
                data-testid="ai-prompt-input"
                placeholder="Опишите, какой контент вы хотите сгенерировать"
                className="col-span-3 !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600 !placeholder:text-gray-500 dark:!placeholder:text-gray-400"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-4 items-start gap-3">
              <Label className="text-right pt-2 text-sm">
                Ключевые слова
              </Label>
              <div className="col-span-3 grid grid-cols-2 gap-1 max-h-[150px] overflow-y-auto !border !border-gray-300 dark:!border-gray-600 rounded p-1 !bg-white dark:!bg-gray-800">
                {keywords.length === 0 ? (
                  <p className="text-xs text-muted-foreground col-span-2">
                    Нет доступных ключевых слов. Добавьте их в раздел "Ключевые слова".
                  </p>
                ) : (
                  // Отфильтруем ключевые слова, оставив непустые
                  keywords
                    .filter(kw => kw.keyword && kw.keyword.trim() !== '')
                    .map((kw) => (
                      <div key={kw.id} className="flex items-start space-x-1">
                        <Checkbox
                          id={`keyword-${kw.id}`}
                          data-testid={`keyword-checkbox-${kw.id}`}
                          checked={selectedKeywords.includes(kw.keyword)}
                          onCheckedChange={() => handleKeywordToggle(kw.keyword)}
                          className="mt-0.5 !border-gray-300 dark:!border-gray-600 data-[state=checked]:!bg-blue-600 data-[state=checked]:!text-white"
                        />
                        <Label
                          htmlFor={`keyword-${kw.id}`}
                          className="cursor-pointer text-xs"
                        >
                          {kw.keyword} ({kw.trendScore})
                        </Label>
                      </div>
                    ))
                )}
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-2">
              <Button variant="outline" onClick={onClose} size="sm" className="w-[100px] !bg-white dark:!bg-gray-700 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600 hover:!bg-gray-100 dark:hover:!bg-gray-600">
                Отмена
              </Button>
              <Button
                onClick={() => generateContent()}
                size="sm"
                data-testid="ai-generate-button"
                className="w-[150px] bg-blue-600 hover:bg-blue-700 text-white"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Генерация...
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-1 h-3 w-3" />
                    Сгенерировать
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-4 mb-2">
              <Label htmlFor="title" className="whitespace-nowrap">
                Название:
              </Label>
              <Input
                id="title"
                placeholder="Введите название для контента"
                className="flex-grow !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600 !placeholder:text-gray-500 dark:!placeholder:text-gray-400"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <Label htmlFor="generatedContent" className="text-left mb-2 font-bold text-lg">
                Результат генерации:
              </Label>
              <div className="min-h-0 border rounded max-h-[300px] overflow-auto">
                <RichTextEditor
                  value={generationResult || ''}
                  onChange={(html: string) => setGenerationResult(html)}
                  minHeight={150}
                  className="tiptap w-full"
                  enableResize={false}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 pt-2 border-t flex-shrink-0">
          {!generationResult ? (
            <>

            </>
          ) : (
            <div className="flex w-full justify-between space-x-4">
              <Button
                variant="outline"
                onClick={() => setGenerationResult(null)}
                className="!bg-white dark:!bg-gray-700 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600 hover:!bg-gray-100 dark:hover:!bg-gray-600"
              >
                Назад
              </Button>
              <Button
                onClick={() => saveContent()}
                disabled={isSaving || !title.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  "Сохранить"
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog >
  );
}