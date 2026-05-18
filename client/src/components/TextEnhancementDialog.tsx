import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface TextEnhancementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText: string;
  onSave: (enhancedText: string) => void;
}

// Предустановленные промпты для улучшения текста
const ENHANCEMENT_PROMPTS = [
  {
    id: "improve",
    name: "Улучшить текст",
    prompt: "Улучши и обогати этот текст: сделай его более убедительным, ярким и запоминающимся. Сохрани все эмодзи из оригинала и добавь новые уместные эмодзи там, где их не было. Сохрани и улучши HTML-структуру (абзацы <p>, списки <ul><li>, жирный <b>, курсив <em>). Можешь расширить текст, добавив конкретику, примеры или детали — если это улучшит содержание. Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  },
  {
    id: "shorten",
    name: "Сократить текст",
    prompt: "Сократи этот текст, сохранив основной смысл и ключевые тезисы. Убери повторения и лишние детали. Сохрани все эмодзи из оригинала, сохрани HTML-структуру (<p>, <b>, <em>, <ul>, <li>). Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  },
  {
    id: "expand",
    name: "Расширить текст",
    prompt: "Существенно расширь и дополни этот текст: добавь конкретные примеры, статистику, детали и пояснения. Сделай его значительно более информативным и полным. Сохрани все эмодзи из оригинала и добавь новые уместные эмодзи. Используй HTML-структуру (<p>, <b>, <em>, <ul>, <li>). Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  },
  {
    id: "friendly",
    name: "Сделать дружелюбнее",
    prompt: "Перепиши текст в более дружелюбном и разговорном стиле. Добавь личных обращений, замени формальные выражения на тёплые и простые. Сохрани все эмодзи из оригинала и добавь новые уместные эмодзи. Используй HTML-структуру (<p>, <b>, <em>, <ul>, <li>). Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  },
  {
    id: "professional",
    name: "Сделать профессиональнее",
    prompt: "Перепиши текст в профессиональном деловом стиле: формальный, структурированный, солидный тон. Сохрани все эмодзи из оригинала (если они уместны в деловом тексте), сохрани HTML-структуру (<p>, <b>, <em>, <ul>, <li>). Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  },
  {
    id: "fix",
    name: "Исправить ошибки",
    prompt: "Исправь в тексте грамматические, стилистические и пунктуационные ошибки. Улучши структуру предложений, сохраняя исходный смысл. Сохрани все эмодзи из оригинала, сохрани HTML-структуру (<p>, <b>, <em>, <ul>, <li>). Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  },
  {
    id: "emoji",
    name: "Добавить эмодзи",
    prompt: "Добавь в текст уместные эмодзи, чтобы сделать его ярким и привлекательным. Размести эмодзи рядом с соответствующими тезисами — в начале абзацев, перед списками, рядом с ключевыми словами. Сохрани все уже имеющиеся эмодзи. Сохрани HTML-структуру (<p>, <b>, <em>, <ul>, <li>). Верни ТОЛЬКО HTML-текст без пояснений и обёрток."
  }
];

// Сервисы AI и их модели
const AI_SERVICES = [
  {
    id: "gemini",
    name: "Gemini",
    default: true,
    models: [
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        default: true
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro"
      },
      {
        id: "gemini-3.0-pro",
        name: "Gemini 3.0 Pro"
      }
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        default: true
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        default: false
      }
    ]
  },
  {
    id: "qwen",
    name: "Qwen",
    models: [
      {
        id: "qwen-max",
        name: "Qwen Max",
        default: true
      },
      {
        id: "qwen-plus",
        name: "Qwen Plus"
      }
    ]
  }
];

export function TextEnhancementDialog({
  open,
  onOpenChange,
  initialText,
  onSave
}: TextEnhancementDialogProps) {
  const [text, setText] = useState(initialText);
  const [enhancedText, setEnhancedText] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState("improve");
  const [selectedService, setSelectedService] = useState(AI_SERVICES.find(s => s.default)?.id || "gemini");
  const [selectedModelId, setSelectedModelId] = useState(() => {
    const defaultService = AI_SERVICES.find(s => s.default) || AI_SERVICES[0];
    const defaultModel = defaultService.models.find(m => m.default) || defaultService.models[0];
    return defaultModel?.id || "";
  });
  const [hasApiKey, setHasApiKey] = useState(true); // Предполагаем, что ключ есть, потом проверим
  
  const { toast } = useToast();
  
  // Получаем доступные модели для выбранного сервиса
  const getModelsForService = () => {
    const service = AI_SERVICES.find(s => s.id === selectedService);
    return service ? service.models : [];
  };
  
  // Устанавливаем модель по умолчанию при выборе сервиса
  useEffect(() => {
    const service = AI_SERVICES.find(s => s.id === selectedService);
    if (service) {
      const defaultModel = service.models.find(m => m.default);
      setSelectedModelId(defaultModel?.id || service.models[0]?.id || "");
    }
  }, [selectedService]);

  // Сбрасываем состояние при открытии диалога
  useEffect(() => {
    if (open) {
      setText(initialText);
      setEnhancedText("");
    }
  }, [open, initialText]);

  // Получаем текущий промпт
  const getCurrentPrompt = () => {
    const selectedPrompt = ENHANCEMENT_PROMPTS.find(p => p.id === selectedPromptId);
    return customPrompt || (selectedPrompt ? selectedPrompt.prompt : "");
  };

  // Получение эндпоинта API в зависимости от выбранного сервиса и модели
  const getApiEndpoint = () => {
    switch (selectedService) {
      case 'deepseek':
        return '/deepseek/improve-text';
      case 'qwen':
        return '/qwen/improve-text';
      case 'gemini':
        // Временно используем стандартный Gemini API для всех моделей
        return '/gemini/improve-text';
      default:
        return '/gemini/improve-text';
    }
  };
  

  
  // Мутация для улучшения текста через единый эндпоинт генерации контента
  const { mutate: improveText, isPending } = useMutation({
    mutationFn: async () => {
      // Получаем токен авторизации
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error('Требуется авторизация');
      }

      // Формируем промпт для улучшения текста
      const enhancementPrompt = `${getCurrentPrompt()}

Исходный текст для улучшения:
${text}`;

      // Используем API с увеличенным таймаутом для AI запросов
      const response = await api.post(getApiEndpoint(), {
        text: text,
        prompt: getCurrentPrompt(),
        model: selectedModelId
      }, {
        timeout: 120000, // 2 минуты для AI обработки
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      return response.data.content || response.data.text || response.data.improvedText;
    },
    onSuccess: (data) => {

      
      let processedText = data;
      
      // Проверяем, в HTML формате ли ответ AI
      const isHtmlFormat = /<[a-z][\s\S]*?>/i.test(data);
      
      if (!isHtmlFormat) {
        // Текст в plain/markdown — конвертируем в HTML
        processedText = data
          .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
          .replace(/__(.*?)__/g, '<u>$1</u>')
          .replace(/~~(.*?)~~/g, '<s>$1</s>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/_(.*?)_/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code>$1</code>');
        
        // Разбиваем на абзацы по двойным переносам
        const paragraphs = processedText.split(/\n\s*\n/);
        processedText = paragraphs
          .map((paragraph: string) => {
            const formattedParagraph = paragraph.replace(/\n/g, '<br>');
            return `<p>${formattedParagraph}</p>`;
          })
          .join('');
      } else {
        // Ответ уже HTML — конвертируем возможные остатки markdown внутри HTML
        processedText = data
          .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
          .replace(/__(.*?)__/g, '<u>$1</u>')
          .replace(/~~(.*?)~~/g, '<s>$1</s>');
        // Одиночные * и _ НЕ трогаем — они могут быть частью эмодзи или текста
      }
      

      
      setEnhancedText(processedText);
      
      // Показываем уведомление об успешном улучшении
      toast({
        title: "Готово!",
        description: "Текст улучшен и применен в редакторе",
      });
      
      // Сразу применяем улучшенный текст и закрываем диалог
      onSave(processedText);
      onOpenChange(false);
    },
    onError: (error: any) => {
      // Проверяем, нужен ли API ключ
      if (error.response?.data?.needApiKey) {
        setHasApiKey(false);
      }
      
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message || "Не удалось улучшить текст",
      });
    }
  });

  // Обработчик сохранения улучшенного текста
  const handleSave = () => {
    onSave(enhancedText);
    onOpenChange(false);
  };

  // Обработчик изменения стиля улучшения
  const handlePromptChange = (value: string) => {
    setSelectedPromptId(value);
    // Сбрасываем кастомный промпт при выборе предустановленного
    setCustomPrompt("");
  };

  // Обработчик изменения модели
  const handleModelChange = (value: string) => {
    setSelectedModelId(value);
  };

  // Открытие настроек, если API ключ не настроен
  const openSettings = () => {
    // Закрываем текущий диалог
    onOpenChange(false);
    
    // Открываем диалог настроек
    document.getElementById('settings-dialog-trigger')?.click();
    
    toast({
      title: `Необходим API ключ ${
        selectedService === 'deepseek' ? 'DeepSeek' : 
        selectedService === 'gemini' ? 'Gemini' : 'Qwen'
      }`,
      description: `Перейдите в настройки и добавьте API ключ ${
        selectedService === 'deepseek' ? 'DeepSeek' : 
        selectedService === 'gemini' ? 'Gemini' : 'Qwen'
      }`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Улучшение текста с помощью AI</DialogTitle>
        </DialogHeader>
        
        {!hasApiKey ? (
          <div className="space-y-4 py-4">
            <div className="bg-amber-50 p-4 rounded-md border border-amber-200">
              <h3 className="text-lg font-medium text-amber-800 mb-2">Требуется настройка API ключа</h3>
              <p className="text-amber-700 mb-4">
                Для использования {selectedService === 'deepseek' ? 'DeepSeek' : selectedService === 'gemini' ? 'Gemini' : 'Qwen'} необходимо добавить API ключ в настройках.
              </p>
              <Button variant="outline" onClick={openSettings}>
                Открыть настройки
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label htmlFor="enhancement-type" className="mb-2 block">Тип улучшения</Label>
                <Select value={selectedPromptId} onValueChange={handlePromptChange}>
                  <SelectTrigger id="enhancement-type">
                    <SelectValue placeholder="Выберите тип улучшения" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    {ENHANCEMENT_PROMPTS.map(prompt => (
                      <SelectItem key={prompt.id} value={prompt.id}>
                        {prompt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="service-select" className="mb-2 block">AI сервис</Label>
                  <Select 
                    value={selectedService} 
                    onValueChange={(value) => setSelectedService(value)}
                  >
                    <SelectTrigger id="service-select">
                      <SelectValue placeholder="Выберите AI сервис" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      {AI_SERVICES.map(service => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="model-select" className="mb-2 block">Модель</Label>
                  <Select value={selectedModelId} onValueChange={handleModelChange}>
                    <SelectTrigger id="model-select">
                      <SelectValue placeholder="Выберите модель" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      {getModelsForService().map((model: {id: string, name: string}) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <div>
              <Label htmlFor="custom-prompt" className="mb-2 block">Пользовательская инструкция (необязательно)</Label>
              <Textarea
                id="custom-prompt"
                placeholder="Введите свою инструкцию для AI, если хотите задать конкретные требования к улучшению текста"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="min-h-20"
              />
            </div>
            
            {/* Скрытые текстовые поля - мы скрываем их от пользователя, но они все еще используются для хранения данных */}
            <div className="hidden">
              <Textarea
                id="original-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Textarea
                id="enhanced-text"
                value={enhancedText}
                onChange={(e) => setEnhancedText(e.target.value)}
              />
            </div>
            
            {/* Индикатор загрузки во время обработки */}
            {isPending && (
              <div className="my-4 flex flex-col items-center justify-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-sm font-medium">Улучшаем текст...</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Это может занять некоторое время в зависимости от размера текста и выбранной модели
                </div>
              </div>
            )}
            
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="default"
                onClick={() => improveText()}
                disabled={isPending || !text?.trim()}
                className="w-full"
              >
                Улучшить и применить текст
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}