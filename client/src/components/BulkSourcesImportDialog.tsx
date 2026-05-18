import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileUp, List, AlertCircle, Check } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

interface BulkSourcesImportDialogProps {
  campaignId: string;
  onClose: () => void;
}

interface SourceResult {
  url: string;
  name: string;
  success: boolean;
  message?: string;
}

export function BulkSourcesImportDialog({ campaignId, onClose }: BulkSourcesImportDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sourceText, setSourceText] = useState<string>("");
  const [sourceType, setSourceType] = useState<string>("auto");
  const [fileContent, setFileContent] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("text");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<'input' | 'processing' | 'results'>('input');

  // Функция для обработки импорта текстовых данных
  const processSourcesText = () => {
    const lines = sourceText.split(/\r?\n/).filter(line => line.trim() !== "");
    
    if (lines.length === 0) {
      toast({
        title: "Ошибка",
        description: "Необходимо ввести хотя бы один URL источника",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setCurrentStep('processing');
    setResults([]);
    setProgress(0);
    
    processSourcesArray(lines);
  };

  // Функция для обработки файла
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      
      // Показываем предпросмотр содержимого файла
      const lines = content.split(/\r?\n/).filter(line => line.trim() !== "");
      setSourceText(lines.join("\n"));
    };
    reader.readAsText(file);
  };

  // Функция для обнаружения типа источника по URL
  const detectSourceType = (url: string): string => {
    const normalizedUrl = url.toLowerCase();
    
    if (normalizedUrl.includes('t.me') || normalizedUrl.includes('telegram')) {
      return 'telegram';
    } else if (normalizedUrl.includes('vk.com') || normalizedUrl.includes('vkontakte')) {
      return 'vk';
    } else if (normalizedUrl.includes('instagram') || normalizedUrl.includes('ig.me')) {
      return 'instagram';
    } else if (normalizedUrl.includes('facebook') || normalizedUrl.includes('fb.com') || normalizedUrl.includes('fb.me')) {
      return 'facebook';
    } else {
      return 'website';
    }
  };

  // Мутация для добавления источника
  const addSourceMutation = useMutation({
    mutationFn: async ({ url, type, name }: { url: string; type: string; name: string }) => {
      const actualType = type === 'auto' ? detectSourceType(url) : type;
      
      const response = await fetch('/api/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          name: name || url,
          url: url,
          type: actualType,
          campaignId: campaignId,
          isActive: true
        })
      });

      const data = await response.json();
      
      // Если это ошибка дублирования, возвращаем специальный объект
      if (!response.ok && response.status === 409 && data.code === 'DUPLICATE_SOURCE_URL') {
        return {
          success: false,
          isDuplicate: true,
          message: 'Источник уже существует'
        };
      }
      
      // Для других ошибок бросаем исключение
      if (!response.ok) {
        throw new Error(data.message || 'Ошибка при добавлении источника');
      }
      
      return data;
    }
  });

  // Функция для обработки массива источников
  const processSourcesArray = async (sources: string[]) => {
    const results: SourceResult[] = [];
    let processedCount = 0;

    for (const source of sources) {
      try {
        // Очистка URL от пробелов и проверка на пустоту
        const url = source.trim();
        if (!url) continue;

        // Попытка получить название из формата "url|название"
        let name = '';
        let cleanUrl = url;

        // Проверяем на правильный формат url|название
        if (url.includes('|')) {
          const parts = url.split('|');
          if (parts.length === 2) {
            cleanUrl = parts[0].trim();
            name = parts[1].trim();
          } else {
            // Если формат некорректный, используем весь URL
            cleanUrl = url.trim();
          }
        }

        // Убираем некорректные префиксы 'https://' или 'http://' в начале имени
        if (name.toLowerCase().startsWith('https://') || name.toLowerCase().startsWith('http://')) {
          name = '';
        }

        // Базовая валидация URL - проверяем наличие хотя бы одной точки и отсутствие пробелов
        if (!cleanUrl.includes('.') || cleanUrl.includes(' ')) {
          results.push({
            url: url.trim(),
            name: name || url.trim(),
            success: false,
            message: 'Некорректный URL-адрес'
          });
          continue;
        }
        
        // Проверка, является ли строка URL и добавляем протокол если нужно
        if (!cleanUrl.startsWith('http') && !cleanUrl.startsWith('https')) {
          cleanUrl = 'https://' + cleanUrl;
        }

        // Добавляем источник
        const response = await addSourceMutation.mutateAsync({
          url: cleanUrl,
          type: sourceType,
          name: name
        });

        results.push({
          url: cleanUrl,
          name: name || cleanUrl,
          success: response.success !== false,
          message: response.isDuplicate ? 'Уже существует' : 
                   (response.message || (response.success === false ? 'Ошибка при добавлении' : 'Успешно добавлен'))
        });
      } catch (error) {
        results.push({
          url: source.trim(),
          name: source.trim(),
          success: false,
          message: error instanceof Error ? error.message : 'Неизвестная ошибка'
        });
      }

      processedCount++;
      setProgress(Math.floor((processedCount / sources.length) * 100));
      setResults([...results]);
    }

    setIsProcessing(false);
    setCurrentStep('results');
    
    // Обновляем список источников в кеше
    queryClient.invalidateQueries({ queryKey: ["campaign_content_sources"] });

    // Показываем уведомление
    const successCount = results.filter(r => r.success && !r.message?.includes('Уже существует')).length;
    const duplicateCount = results.filter(r => r.message?.includes('Уже существует')).length;
    const errorCount = results.filter(r => !r.success && !r.message?.includes('Уже существует')).length;
    
    let description = `Добавлено ${successCount} источников`;
    if (duplicateCount > 0) {
      description += `, пропущено ${duplicateCount} дубликатов`;
    }
    if (errorCount > 0) {
      description += `, ошибок: ${errorCount}`;
    }

    toast({
      title: "Импорт завершен",
      description: description,
      variant: successCount > 0 ? "default" : "destructive"
    });
  };

  return (
    <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Импорт источников</DialogTitle>
        <DialogDescription>
          Добавьте несколько источников одновременно для кампании
        </DialogDescription>
      </DialogHeader>

      {currentStep === 'input' && (
        <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">Ввод текста</TabsTrigger>
            <TabsTrigger value="file">Загрузка файла</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="sources_textarea">Введите URL источников (по одному в строке)</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Формат: один URL в строке, или <strong>URL|название</strong> для указания названия (название необязательно).
                  <br />Каждый источник должен быть на новой строке.
                </p>
                <Textarea
                  id="sources_textarea"
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="https://t.me/channel1
t.me/channel2
vk.com/group_name
https://t.me/mychannel|Телеграм канал"
                  className="min-h-[200px]"
                />
              </div>

              <div>
                <Label htmlFor="source_type">Тип источников</Label>
                <Select
                  value={sourceType}
                  onValueChange={setSourceType}
                >
                  <SelectTrigger id="source_type">
                    <SelectValue placeholder="Выберите тип источника" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    <SelectItem value="auto">Определить автоматически</SelectItem>
                    <SelectItem value="website">Веб-сайт</SelectItem>
                    <SelectItem value="telegram">Telegram канал</SelectItem>
                    <SelectItem value="vk">VK группа</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  При выборе "Определить автоматически" тип будет определен на основе URL
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="file" className="space-y-4 py-4">
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Информация о формате файла</AlertTitle>
                <AlertDescription>
                  Загрузите текстовый файл (CSV или TXT) со списком URL источников. 
                  Каждый URL должен быть на новой строке. Формат каждой строки: URL или URL|название (название необязательно)
                  <br /><br />Пример содержимого файла:<br />
                  <code>
                    https://t.me/channel1<br />
                    t.me/channel2<br />
                    https://t.me/mychannel|Телеграм канал<br />
                  </code>
                </AlertDescription>
              </Alert>
              
              <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="file_upload">Выберите файл</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    id="file_upload"
                    accept=".txt,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => document.getElementById('file_upload')?.click()}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    Выбрать файл
                  </Button>
                </div>
              </div>
              
              {fileContent && (
                <div className="space-y-2">
                  <Label>Предпросмотр содержимого файла</Label>
                  <div className="text-sm max-h-[200px] overflow-y-auto p-2 border rounded-md whitespace-pre-wrap">
                    {sourceText}
                  </div>
                  
                  <div>
                    <Label htmlFor="source_type_file">Тип источников</Label>
                    <Select
                      value={sourceType}
                      onValueChange={setSourceType}
                    >
                      <SelectTrigger id="source_type_file">
                        <SelectValue placeholder="Выберите тип источника" />
                      </SelectTrigger>
                      <SelectContent className="z-[9999]">
                        <SelectItem value="auto">Определить автоматически</SelectItem>
                        <SelectItem value="website">Веб-сайт</SelectItem>
                        <SelectItem value="telegram">Telegram канал</SelectItem>
                        <SelectItem value="vk">VK группа</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="facebook">Facebook</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {currentStep === 'processing' && (
        <div className="space-y-4 py-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-medium">Добавление источников...</h3>
            <p className="text-sm text-muted-foreground">
              Обработано {results.length} из {sourceText.split(/\r?\n/).filter(line => line.trim() !== "").length} источников
            </p>
          </div>
          
          <Progress value={progress} className="w-full" />
          
          <div className="max-h-[300px] overflow-y-auto border rounded-md p-2">
            {results.map((result, index) => (
              <div key={index} className={`flex items-center gap-2 p-1 ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                {result.success ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <span className="text-sm truncate">{result.name || result.url}</span>
              </div>
            ))}
            {isProcessing && (
              <div className="flex items-center gap-2 p-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Обработка...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {currentStep === 'results' && (
        <div className="space-y-4 py-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-medium">Импорт завершен</h3>
            <p className="text-sm text-muted-foreground">
              Успешно добавлено {results.filter(r => r.success).length} из {results.length} источников
            </p>
          </div>
          
          <div className="max-h-[300px] overflow-y-auto border rounded-md p-2">
            {results.map((result, index) => (
              <div key={index} className={`flex items-start gap-2 p-2 border-b last:border-0 ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                {result.success ? <Check className="h-4 w-4 mt-0.5" /> : <AlertCircle className="h-4 w-4 mt-0.5" />}
                <div>
                  <div className="text-sm font-medium">{result.name || result.url.split('/')[result.url.split('/').length > 2 ? 2 : 0]}</div>
                  <div className="text-xs break-all">{result.url}</div>
                  {!result.success && result.message && (
                    <div className="text-xs text-muted-foreground mt-1">{result.message}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        {currentStep === 'input' && (
          <>
            <Button variant="outline" onClick={onClose} type="button">
              Отмена
            </Button>
            <Button 
              onClick={processSourcesText} 
              disabled={!sourceText.trim()}
              type="button"
            >
              <List className="mr-2 h-4 w-4" />
              Импортировать
            </Button>
          </>
        )}
        
        {currentStep === 'processing' && (
          <Button variant="outline" onClick={onClose} type="button" disabled>
            Подождите...
          </Button>
        )}
        
        {currentStep === 'results' && (
          <>
            <Button onClick={() => { setCurrentStep('input'); setResults([]) }} type="button" variant="outline">
              Импортировать еще
            </Button>
            <Button onClick={onClose} type="button">
              Закрыть
            </Button>
          </>
        )}
      </div>
    </DialogContent>
  );
}
