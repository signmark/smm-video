import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from "@/components/ui/select";
import { Loader2, Image, RefreshCw, Sparkles, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { SUPPORTED_STYLES, STYLE_DESCRIPTIONS, ASPECT_RATIOS } from "../../../shared/fal-ai-styles";

/**
 * ОТКЛЮЧЕНО: Извлечение ключевых слов больше не используется
 * Это предотвращает утечку данных между постами и нежелательное вмешательство в контент
 */
/**
 * Функция отключена: мы не извлекаем ключевые слова автоматически
 * Это нужно чтобы избежать передачи данных между разными постами
 */
async function extractKeywordsFromText(text: string): Promise<string[]> {
  return []; // Всегда возвращаем пустой массив
}

interface ContentItem {
  content: string;
  originalContent?: string;
  imagePrompt?: string;
  prompt?: string; // Добавляем поле prompt, которое приходит из n8n
  [key: string]: any; // Для других возможных полей
}

interface ImageGenerationDialogProps {
  campaignId?: string;
  contentId?: string; // ID контента для привязки изображений
  businessData?: {
    companyName: string;
    businessDescription: string;
    brandImage: string;
    productsServices: string;
  };
  initialContent?: string | ContentItem; // Начальный контент для подсказки, может быть строкой или объектом
  initialPrompt?: string; // Готовый промт из контент-плана
  onImageGenerated?: (imageUrl: string, promptText?: string) => void;
  onClose: () => void;
}

// Определяем список моделей по умолчанию с Gemini первым
const DEFAULT_MODELS = [
  // Gemini как рекомендуемая модель по умолчанию (Nanobanana = Gemini для картинок)
  {
    id: 'gemini',
    name: '🍌 Nano Banana',
    description: 'Gemini 2.5 Flash Image - быстрая генерация, отличный текст в изображениях ($0.039)'
  },
  // NanoBanana Pro - Gemini 3 Pro Image через FAL
  {
    id: 'fal-ai/nano-banana-pro',
    name: '🍌⚡ NanoBanana Pro',
    description: 'Gemini 3 Pro Image - высочайшее качество ($0.15)'
  },
  // NanoBanana Pro/Edit - редактирование изображений
  {
    id: 'fal-ai/nano-banana-pro/edit',
    name: '🍌✏️ NanoBanana Pro/Edit',
    description: 'Редактирование изображений по промту ($0.15)'
  },
  // GPT-Image-2 через FAL.AI (не требует верификации организации)
  {
    id: 'fal-ai/gpt-image-2',
    name: '🤖 GPT-Image-2',
    description: 'OpenAI gpt-image-2 через FAL.AI — высочайшее качество, фотореализм, текст в изображении',
    type: 'fal'
  },
  // GPT-Image-2 напрямую через OpenAI API (верифицированная организация)
  {
    id: 'openai/gpt-image-2',
    name: '🤖 GPT-Image-2 (direct)',
    description: 'OpenAI gpt-image-2 прямой API — максимальное качество, фотореализм, текст в изображении',
    type: 'openai'
  },
  // Schnell как вторая опция
  {
    id: 'schnell',
    name: 'Schnell',
    description: 'Schnell - высококачественная модель для быстрой генерации'
  },
  // Другие модели
  {
    id: 'flux/juggernaut-xl-lora',
    name: 'Juggernaut Flux Lora',
    description: 'Топовое качество детализированных изображений'
  },
  {
    id: 'flux/juggernaut-xl-lightning',
    name: 'Juggernaut Flux Lightning',
    description: 'Средняя скорость и хорошее качество изображений'
  },
  {
    id: 'flux/flux-lora',
    name: 'Flux Lora',
    description: 'Альтернативная модель высокого качества'
  },
  {
    id: 'fooocus',
    name: 'Fooocus',
    description: 'Fooocus - мощная модель с продвинутой композицией'
  },
  {
    id: 'fast-sdxl',
    name: 'Fast SDXL',
    description: 'Быстрая версия Stable Diffusion XL'
  }
];

export function ImageGenerationDialog({
  campaignId,
  contentId,
  businessData,
  initialContent,
  initialPrompt,
  onImageGenerated,
  onClose
}: ImageGenerationDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>("prompt");

  const { data: imageGenUsage } = useQuery<{
    count: number; limit: number | null; remaining: number | null;
  }>({
    queryKey: ['/api/user/image-gen-usage'],
    staleTime: 0,
    refetchOnMount: true,
  });
  
  // Инициализируем состояние с пустыми значениями, мы обновим их в useEffect
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [imageSize, setImageSize] = useState<string>("1024x1024");
  const [content, setContent] = useState("");
  const [platform, setPlatform] = useState<"instagram" | "telegram" | "vk" | "facebook">("instagram");
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(-1);
  const [modelType, setModelType] = useState<string>("gemini"); // По умолчанию используем Gemini (OAuth2 настроен)
  const [stylePreset, setStylePreset] = useState<string>("photographic"); // Стиль изображения по умолчанию
  const [numImages, setNumImages] = useState<number>(3); // Количество изображений для генерации (по умолчанию 3)
  const [generatedPrompt, setGeneratedPrompt] = useState<string>(""); // Сохраняем сгенерированный промт
  const [savePrompt, setSavePrompt] = useState<boolean>(true); // Флаг для сохранения промта в БД
  const [availableModels, setAvailableModels] = useState<{id: string, name: string, description: string, type?: string}[]>([]); // Список моделей с сервера
  const [sourceImageUrl, setSourceImageUrl] = useState<string>(""); // URL исходного изображения для редактирования
  const [sourceImagePreview, setSourceImagePreview] = useState<string>(""); // Превью загруженного изображения
  const [gptImageQuality, setGptImageQuality] = useState<'low' | 'medium' | 'high'>('medium'); // Качество для GPT-Image-1
  
  // Проверяем, является ли выбранная модель edit-моделью
  const isEditModel = modelType === 'fal-ai/nano-banana-pro/edit';
  const isGptImageModel = modelType === 'openai/gpt-image-2' || modelType === 'gpt-image-2' || modelType === 'openai/gpt-image-1' || modelType === 'gpt-image-1';
  
  // При монтировании компонента и при изменении входных параметров сбрасываем и инициализируем значения
  useEffect(() => {
    // Очищаем начальные данные от HTML
    const simpleCleanHtml = (html: string): string => {
      if (!html || typeof html !== 'string') return '';
      return html.replace(/<[^>]*>/g, '');
    };

    
    // Полный сброс всех состояний
    setNegativePrompt("");
    setImageSize("1024x1024");
    setContent("");
    setPlatform("instagram");
    setGeneratedImages([]);
    setSelectedImageIndex(-1);
    // Устанавливаем schnell как модель по умолчанию
    setModelType("schnell");
    setStylePreset("photographic");
    setNumImages(3); // Используем 3 изображения по умолчанию
    setSavePrompt(true);
    
    // Обработка промта по приоритетам:
    // 1. Если это редактирование существующего контента (contentId) и есть промт, используем его
    // 2. Если есть originalContent в initialContent (использовать как промпт), используем его
    // 3. Если это новый контент, всегда начинаем с пустого промта
    // 4. Если есть контент, подготавливаем его для возможной генерации промта
    
    // Сначала проверим, если в initialContent есть поле originalContent, которое передаётся из ContentPlanGenerator
    const contentObject = typeof initialContent === 'object' ? initialContent as ContentItem : null;
    // Проверяем наличие всех возможных полей для использования как промпт
    const originalContent = contentObject?.prompt || contentObject?.originalContent || contentObject?.imagePrompt || null;
    
    if (contentId && initialPrompt) {
      // Редактирование с сохраненным промтом - используем его
      const cleanPrompt = simpleCleanHtml(initialPrompt);
      setPrompt(cleanPrompt);
      setGeneratedPrompt(cleanPrompt);

    } else if (originalContent) {
      // Используем originalContent как промпт
      const cleanPrompt = simpleCleanHtml(originalContent);
      setPrompt(cleanPrompt);
      setGeneratedPrompt(cleanPrompt);

    } else {
      // Либо новый контент, либо редактирование без промта - в любом случае сбрасываем
      setPrompt("");
      setGeneratedPrompt("");
    }
    
    // Обрабатываем initialContent, который может быть строи или объектом
    if (initialContent) {
      let contentText = '';
      
      // Если initialContent - объект, извлекаем текст из поля content
      if (typeof initialContent === 'object' && initialContent !== null) {
        const contentItem = initialContent as ContentItem;
        contentText = contentItem.content || '';
      } else if (typeof initialContent === 'string') {
        contentText = initialContent;
      }
      
      // Очищаем теги из начального контента
      const cleanedContent = simpleCleanHtml(contentText);
      setContent(cleanedContent);

    } else {
      // Сбрасываем контент если его нет
      setContent("");
    }
    
    // Выбираем активную вкладку в зависимости от данных
    if (initialPrompt) {
      // Если есть промт, переключаемся на вкладку прямого промта
      setActiveTab("prompt");
    } else if (initialContent) {
      // Если нет промта, но есть контент
      setActiveTab("social"); // Переключаемся на вкладку социальных сетей
    } else {
      // Если вообще нет данных
      setActiveTab("prompt"); // По умолчанию открываем вкладку произвольного запроса
    }
    
  }, [contentId, initialContent, initialPrompt]); // Добавляем зависимость от всех важных параметров
  
  // При монтировании компонента загружаем доступные модели FAL.AI
  useEffect(() => {
    const fetchModels = async () => {
      try {
        // Добавляем случайный параметр для предотвращения кеширования
        const response = await api.get('/fal-ai-models?nocache=' + Date.now());
        if (response.data?.success && response.data?.models) {
          setAvailableModels(response.data.models);
        }
      } catch (error) {
        console.error('Ошибка при получении списка моделей:', error);
      }
    };

    fetchModels();
  }, []); // Выполняем только один раз при монтировании компонента
  
  const { toast } = useToast();
  
  // Разбор размера изображения на ширину и высоту
  const getImageDimensions = () => {
    const [width, height] = imageSize.split("x").map(Number);
    return { width, height };
  };
  
  // Мутация для генерации промта из текста
  const { mutate: generateTextPrompt, isPending: isPromptGenerationPending } = useMutation({
    mutationFn: async () => {
      if (!content) {
        throw new Error("Необходимо ввести текст для генерации промта");
      }
      
      try {
        // Очищаем текст перед отправкой на генерацию промта
        const cleanedText = stripHtml(content);
        
        // Пытаемся извлечь ключевые слова из очищенного текста, если функция доступна
        let keywords: string[] = [];
        if (typeof extractKeywordsFromText === 'function') {
          try {
            keywords = await extractKeywordsFromText(cleanedText) || [];
          } catch (e) {
            // Автоматическое извлечение ключевых слов отключено
          }
        }
        
        // Генерируем промт через DeepSeek напрямую из русского текста
        const response = await api.post("/generate-image-prompt", {
          content: cleanedText, // Отправляем оригинальный русский текст
          keywords: keywords || [] // Добавляем извлеченные ключевые слова для улучшения релевантности
        });
        
        if (response.data?.success && response.data?.prompt) {
          return response.data.prompt;
        } else {
          throw new Error("Не удалось сгенерировать промт");
        }
      } catch (error: unknown) {
        throw error;
      }
    },
    onSuccess: (promptText) => {
      setGeneratedPrompt(promptText);
      setPrompt(promptText);
      toast({
        title: "Успешно",
        description: "Промт сгенерирован на основе текста"
      });
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      console.error("Ошибка при генерации промта:", error);
      
      toast({
        variant: "destructive",
        title: "Ошибка генерации промта",
        description: errorMessage || "Произошла ошибка при генерации промта"
      });
    }
  });

  // Функция для очистки HTML-тегов из текста с сохранением базового форматирования
  const stripHtml = (html: string): string => {
    if (!html || typeof html !== 'string') return '';
    
    try {
      // Преобразуем некоторые теги в текстовые эквиваленты перед удалением
      let processedHtml = html
        .replace(/<p.*?>(.*?)<\/p>/gi, '$1\n\n')
        .replace(/<h[1-6].*?>(.*?)<\/h[1-6]>/gi, '$1\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li.*?>(.*?)<\/li>/gi, '• $1\n')
        .replace(/<a\s+[^>]*href=['"]([^'"]*)['"]\s*[^>]*>(.*?)<\/a>/gi, (match, url, text) => {
          return text && text.trim() ? `${text.trim()} (${url})` : url;
        });
      
      processedHtml = processedHtml.replace(/<[^>]*>/g, '');
      
      processedHtml = processedHtml
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&ndash;/g, '–')
        .replace(/&mdash;/g, '—')
        .replace(/&laquo;/g, '«')
        .replace(/&raquo;/g, '»');
      
      let plainText = processedHtml;
      try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedHtml;
        plainText = tempDiv.textContent || tempDiv.innerText || processedHtml;
      } catch (e) {
        console.warn('Не удалось создать DOM-элемент для декодирования HTML:', e);
      }
      
      const cleanedText = plainText
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s{2,}/g, ' ')
        .trim();
      
      return cleanedText;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Ошибка при очистке HTML:', errorMessage);
      return html.replace(/<[^>]*>/g, '');
    }
  };
  
  // Функция для перевода промта на английский
  const translateToEnglish = async (text: string): Promise<string> => {
    try {
      if (!text.trim()) return text;
      const cleanedText = stripHtml(text);
      const englishPattern = /^[a-zA-Z0-9\s.,!?;:'"()\-_\[\]@#$%^&*+=<>/\\|{}~`]+$/;
      if (englishPattern.test(cleanedText)) {
        return cleanedText;
      }
      
      const response = await api.post('/translate-to-english', { text: cleanedText });
      
      if (response.data?.success && response.data?.translatedText) {
        return response.data.translatedText;
      } else {
        console.warn('Не удалось перевести промт, используем очищенный текст');
        return cleanedText;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Ошибка при переводе промта:', errorMessage);
      return stripHtml(text);
    }
  };

  // Мутация для сохранения промта отдельно от генерации
  const { mutate: savePromptToDb } = useMutation({
    mutationFn: async (promptText: string) => {
      if (!contentId) {
        console.warn('Невозможно сохранить промт: contentId не указан');
        return false;
      }
      
      try {
        const response = await api.patch(`/campaign-content/${contentId}`, {
          prompt: promptText
        });
        
        if (response.data && response.status === 200) {
          return true;
        } else {
          console.warn('⚠️ Сохранение промта вернуло неожиданный ответ:', response.status);
          return false;
        }
      } catch (error: unknown) {
        console.error('❌ Ошибка при сохранении промта:', error);
        return false;
      }
    }
  });

  // Мутация для генерации изображения
  const { mutate: generateImage, isPending: isLoading } = useMutation({
    mutationFn: async () => {
      setGeneratedImages([]);
      setSelectedImageIndex(-1);
      let requestData: {
        prompt?: string;
        negativePrompt?: string;
        originalPrompt?: string;
        originalContent?: string;
        width?: number;
        height?: number;
        campaignId?: string;
        contentId?: string;
        modelName?: string;
        numImages?: number;
        stylePreset?: string;
        savePrompt?: boolean;
        modelParams?: {
          use_api_path?: boolean;
          direct_urls?: boolean;
        };
        provider?: string;
        imageUrls?: string[];
      } = {};
      
      if (activeTab === "prompt" || activeTab === "models") {
        const { width, height } = getImageDimensions();

        if (activeTab === "prompt" && savePrompt && contentId && prompt) {
          await savePromptToDb(prompt);
        }
        
        let enhancedPrompt = prompt;
        if (stylePreset) {
          const styleName = Object.entries(SUPPORTED_STYLES).find(([key]) => key === stylePreset)?.[1] || stylePreset;
          enhancedPrompt = `${styleName} style. ${prompt}`;
        }
        
        const translatedPrompt = await translateToEnglish(enhancedPrompt);
        const translatedNegativePrompt = negativePrompt ? await translateToEnglish(negativePrompt) : negativePrompt;
        
        requestData = {
          prompt: translatedPrompt,
          negativePrompt: translatedNegativePrompt,
          originalPrompt: enhancedPrompt,
          width,
          height,
          campaignId,
          contentId,
          modelName: modelType,
          numImages: numImages,
          stylePreset,
          savePrompt: false,
          ...(isEditModel && sourceImageUrl ? { imageUrls: [sourceImageUrl] } : {}),
          ...(isGptImageModel ? { quality: gptImageQuality } : {})
        };
        
      } else if (activeTab === "text") {
        if (!content) {
          throw new Error("Необходимо ввести текст для генерации");
        }
        
        if (generatedPrompt) {
          let enhancedPrompt = generatedPrompt;
          if (stylePreset) {
            const styleName = Object.entries(SUPPORTED_STYLES).find(([key]) => key === stylePreset)?.[1] || stylePreset;
            enhancedPrompt = `${styleName} style. ${generatedPrompt}`;
          }
          
          if (savePrompt && contentId && enhancedPrompt) {
            await savePromptToDb(enhancedPrompt);
          }
          
          requestData = {
            prompt: enhancedPrompt,
            originalContent: content,
            campaignId,
            contentId,
            modelName: modelType,
            stylePreset,
            numImages,
            savePrompt: false
          };
        } else {
          try {
            const cleanedText = stripHtml(content);
            let keywords: string[] = [];
            if (typeof extractKeywordsFromText === 'function') {
              try {
                keywords = await extractKeywordsFromText(cleanedText) || [];
              } catch (e) { }
            }
            
            const response = await api.post("/generate-image-prompt", {
              content: cleanedText,
              keywords: keywords || []
            });
            
            if (response.data?.success && response.data?.prompt) {
              setGeneratedPrompt(response.data.prompt);
              if (savePrompt && contentId && response.data.prompt) {
                await savePromptToDb(response.data.prompt);
              }
              
              requestData = {
                prompt: response.data.prompt,
                originalContent: content,
                campaignId,
                contentId,
                modelName: modelType,
                stylePreset,
                numImages,
                savePrompt: false
              };
            } else {
              const translatedContent = await translateToEnglish(content);
              let enhancedContent = translatedContent;
              if (stylePreset) {
                const styleName = Object.entries(SUPPORTED_STYLES).find(([key]) => key === stylePreset)?.[1] || stylePreset;
                enhancedContent = `${styleName} style. ${translatedContent}`;
              }
              setGeneratedPrompt(enhancedContent);
              if (savePrompt && contentId && enhancedContent) {
                await savePromptToDb(enhancedContent);
              }
              
              requestData = {
                originalContent: content,
                campaignId,
                contentId,
                modelName: modelType,
                stylePreset,
                numImages,
                savePrompt: false,
                prompt: enhancedContent
              };
            }
          } catch (error: unknown) {
            const translatedContent = await translateToEnglish(content);
            let finalPrompt = translatedContent;
            if (stylePreset && modelType !== 'deepseek') {
              const styleName = Object.entries(SUPPORTED_STYLES).find(([key]) => key === stylePreset)?.[1] || stylePreset;
              finalPrompt = `${styleName} style. ${translatedContent}`;
            }
            setGeneratedPrompt(finalPrompt);
            requestData = {
              originalContent: content,
              campaignId,
              contentId,
              modelName: modelType,
              stylePreset,
              numImages,
              savePrompt: true,
              prompt: translatedContent
            };
          }
        }
      }
      
      requestData.modelParams = {
        use_api_path: true,
        direct_urls: true
      };
      
      const userId = localStorage.getItem('user_id');
      
      try {
        const response = await api.post("/generate-image", requestData, {
          timeout: 300000,
          headers: {
            'x-user-id': userId || ''
          }
        });
        return response.data;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('timeout')) {
          throw new Error(`Превышено время ожидания ответа от сервера при генерации изображений. Попробуйте уменьшить количество изображений или использовать другую модель.`);
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      if (data.success) {
        let images: string[] = [];
        // Проверяем наличие массива изображений в разных форматах ответа
        if (data.images && Array.isArray(data.images)) {
          images = data.images.map((img: any) => typeof img === 'string' ? img : img.url || img.image || '').filter(Boolean);
        } else if (data.data?.images && Array.isArray(data.data.images)) {
          images = data.data.images.map((img: any) => typeof img === 'string' ? img : img.url || img.image || '').filter(Boolean);
        } else if (Array.isArray(data.data)) {
          images = data.data.map((img: any) => typeof img === 'string' ? img : img.url || img.image || '').filter(Boolean);
        } else if (data.imageUrl || data.data?.imageUrl) {
          images = [data.imageUrl || data.data?.imageUrl];
        } else if (typeof data.data === 'string') {
          images = [data.data];
        } else if (data.data?.url || data.data?.image) {
          images = [data.data.url || data.data.image];
        }

        if (images.length > 0) {
          setGeneratedImages(images);
          setSelectedImageIndex(-1);
          // Обновляем счётчик генераций
          queryClient.invalidateQueries({ queryKey: ['/api/user/image-gen-usage'] });
          toast({
            title: "Успешно",
            description: `Сгенерировано ${images.length} ${images.length === 1 ? 'изображение' : 'изображений'}`
          });
        } else {
          console.error('Не удалось найти изображения в ответе:', data);
          toast({
            variant: "destructive",
            title: "Ошибка при обработке результата",
            description: "Не удалось найти URL изображений в ответе сервера"
          });
        }
      } else {
        console.error('Неожиданный формат ответа от API:', data);
        toast({
          variant: "destructive",
          title: "Ошибка при обработке результата",
          description: "Получен неожиданный формат данных от сервера"
        });
      }
    },
    onError: (error: unknown) => {
      console.error('Image generation error:', error);
      const axiosError = error as any;
      const serverMsg = axiosError?.response?.data?.error;
      const statusCode = axiosError?.response?.status;
      let errorMessage: string;
      if (serverMsg) {
        errorMessage = serverMsg; // Уже локализован на бэкенде
      } else if (statusCode === 429) {
        errorMessage = t('errors.rateLimit', 'Превышен лимит запросов. Попробуйте позже или выберите другую модель.');
      } else if (statusCode === 400 && (String(axiosError?.response?.data?.error || '')).includes('paid')) {
        errorMessage = t('errors.paidOnly', 'Генерация изображений доступна только на платном плане. Выберите модель Flux или Schnell.');
      } else {
        errorMessage = error instanceof Error ? error.message : t('errors.generationFailed', 'Произошла ошибка при генерации изображения');
      }
      toast({
        variant: "destructive",
        title: t('errors.generationError', 'Ошибка генерации'),
        description: errorMessage
      });
    }
  });
  
  const handleSelectImage = (index: number) => {
    if (index >= 0 && index < generatedImages.length) {
      setSelectedImageIndex(index);
    }
  };
  
  const confirmSelection = () => {
    if (selectedImageIndex >= 0) {
      if (onImageGenerated) {
        let finalPrompt = "";
        if (activeTab === "prompt" || activeTab === "models") {
          finalPrompt = prompt;
        } else if (activeTab === "text" && generatedPrompt) {
          finalPrompt = generatedPrompt;
        }
        if (!finalPrompt && initialPrompt) {
          finalPrompt = initialPrompt;
        }
        onImageGenerated(generatedImages[selectedImageIndex], finalPrompt);
      }
      onClose();
    } else {
      toast({
        variant: "destructive",
        title: "Выберите изображение",
        description: "Пожалуйста, выберите одно из сгенерированных изображений"
      });
    }
  };

  return (
    <DialogContent className="flex flex-col p-0 gap-0 w-[calc(100vw-2rem)] sm:w-auto sm:max-w-[600px] max-h-[90dvh]">
      <DialogHeader className="px-6 pt-6 pb-3 flex-shrink-0 border-b">
        <div className="flex items-center justify-between">
          <DialogTitle>Генерация изображений</DialogTitle>
          {imageGenUsage && imageGenUsage.limit !== null && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              (imageGenUsage.remaining ?? 0) <= 5
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-muted text-muted-foreground'
            }`}>
              {imageGenUsage.remaining}/{imageGenUsage.limit} в месяц
            </span>
          )}
        </div>
        <DialogDescription className="text-xs text-muted-foreground mt-1">
          Создавайте изображения на основе текста или произвольного запроса. Для достижения лучших результатов добавляйте детали и стилевые особенности в запрос.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs flex justify-between items-center">
            <span>Модель генерации</span>
          </Label>
          <Select 
            value={modelType} 
            onValueChange={(value) => setModelType(value)}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Выберите модель" />
            </SelectTrigger>
            <SelectContent className="z-[9999]">
              {DEFAULT_MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs flex justify-between items-center">
            <span>Размер изображения</span>
          </Label>
          <Select value={imageSize} onValueChange={(value) => setImageSize(value)}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Выберите размер" />
            </SelectTrigger>
            <SelectContent className="z-[9999]">
              {ASPECT_RATIOS.map((ratio) => (
                <SelectItem key={`${ratio.width}x${ratio.height}`} value={`${ratio.width}x${ratio.height}`}>
                  {`${ratio.width}x${ratio.height}`} {ratio.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isGptImageModel && (
        <div className="mb-3 p-3 bg-muted/30 border rounded-lg">
          <Label className="text-sm font-medium mb-2 block">✨ Качество генерации</Label>
          <div className="flex gap-2">
            {(['low', 'medium', 'high'] as const).map((q) => (
              <button
                key={q}
                type="button"
                data-testid={`btn-quality-${q}`}
                onClick={() => setGptImageQuality(q)}
                className={`flex-1 py-1.5 text-sm rounded border transition-colors ${
                  gptImageQuality === q
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/50'
                }`}
              >
                {q === 'low' ? '🔹 Низкое' : q === 'medium' ? '🔸 Среднее' : '💎 Высокое'}
              </button>
            ))}
          </div>
        </div>
      )}

      {isEditModel && (
        <div className={`mb-3 p-3 border rounded-lg transition-colors ${!sourceImageUrl ? 'border-destructive/50 bg-destructive/5' : 'bg-muted/30'}`}>
          <Label className="text-sm font-medium mb-2 block">
            📷 Исходное изображение для редактирования <span className="text-destructive">*</span>
          </Label>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <Input
                type="url"
                value={sourceImageUrl}
                onChange={(e) => {
                  setSourceImageUrl(e.target.value);
                  setSourceImagePreview(e.target.value);
                }}
                placeholder="Вставьте URL изображения или загрузите файл..."
                className="h-9"
              />
              <div className="flex gap-2 mt-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const base64 = event.target?.result as string;
                          setSourceImageUrl(base64);
                          setSourceImagePreview(base64);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <span className="inline-flex items-center px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                    📁 Загрузить файл
                  </span>
                </label>
                {sourceImageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setSourceImageUrl("");
                      setSourceImagePreview("");
                    }}
                    className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
                  >
                    ✕ Очистить
                  </button>
                )}
              </div>
            </div>
            {sourceImagePreview && (
              <div className="w-20 h-20 rounded-md overflow-hidden border bg-muted flex-shrink-0">
                <img
                  src={sourceImagePreview}
                  alt="Preview"
                  className="w-full h-full object-cover"
                  onError={() => setSourceImagePreview("")}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value)} className="w-full">
        <TabsList className="grid grid-cols-2 mb-2">
          <TabsTrigger value="prompt">Произвольный запрос</TabsTrigger>
          <TabsTrigger value="text">На основе текста</TabsTrigger>
        </TabsList>
        
        <TabsContent value="prompt" className="space-y-2">
          <div className="space-y-2">
            <Label>Запрос (промпт)</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Опишите, какое изображение вы хотите получить..."
              className="min-h-[100px]"
            />
          </div>
          
          <div className="space-y-2">
            <Label>Негативный запрос (чего избегать)</Label>
            <Input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="bad quality, blurry, distorted, etc."
            />
          </div>
          
          <div className="space-y-1">
            <Label className="text-xs">Стиль изображения</Label>
            <Select value={stylePreset} onValueChange={(value) => setStylePreset(value)}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Выберите стиль" />
              </SelectTrigger>
              <SelectContent className="z-[9999]">
                {SUPPORTED_STYLES.map((style) => (
                  <SelectItem key={style} value={style}>
                    {STYLE_DESCRIPTIONS[style] || style}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-1">
            <Label className="text-xs">Количество изображений</Label>
            <div className="flex items-center space-x-2">
              <Input
                type="number"
                min={1}
                max={3}
                value={numImages}
                onChange={(e) => setNumImages(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))}
                className="w-16 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">(от 1 до 3)</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 mt-2">
            <Checkbox 
              id="save-prompt-direct" 
              checked={savePrompt}
              onCheckedChange={(checked) => setSavePrompt(!!checked)}
            />
            <label
              htmlFor="save-prompt-direct"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Сохранить промт
            </label>
          </div>
        </TabsContent>
        
        <TabsContent value="text" className="space-y-2">
          <div className="space-y-1">
            <Label>Текст для генерации изображения</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value.replace(/<[^>]*>/g, ''))}
              placeholder="Введите контент поста для генерации изображения..."
              className="min-h-[100px]"
            />
          </div>
          
          <div className="flex justify-between items-center">
            <div className="font-medium text-xs text-muted-foreground">
              Введите текст и нажмите кнопку ниже для генерации промта из текста.
            </div>
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => generateTextPrompt()}
                disabled={isPromptGenerationPending || !content}
                className="mt-1"
              >
                {isPromptGenerationPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Сгенерировать промт
              </Button>
            </div>
          </div>
          
          <div className="space-y-1">
            <Label className="text-xs">Количество изображений</Label>
            <div className="flex items-center space-x-2">
              <Input
                type="number"
                min={1}
                max={3}
                value={numImages}
                onChange={(e) => setNumImages(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))}
                className="w-16 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">(от 1 до 3)</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 mt-2">
            <Checkbox 
              id="save-prompt-text" 
              checked={savePrompt}
              onCheckedChange={(checked) => setSavePrompt(!!checked)}
            />
            <label
              htmlFor="save-prompt-text"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Сохранить промт
            </label>
          </div>
          
          {generatedPrompt && (
            <div className="space-y-1 mt-2">
              <Label className="text-xs">Сгенерированный промт</Label>
              <div className="rounded-md border border-border bg-muted/30 dark:bg-muted/10 p-4">
                <p className="text-xs font-mono whitespace-pre-wrap break-words text-foreground">
                  {generatedPrompt}
                </p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
      
      {isEditModel && !sourceImageUrl && (
        <p className="text-xs text-destructive mt-3 text-center">
          ⚠️ Загрузите исходное изображение для редактирования
        </p>
      )}
      <Button 
        onClick={() => generateImage()} 
        disabled={isLoading || (isEditModel && !sourceImageUrl) || (activeTab === "prompt" && !prompt) || (activeTab === "text" && (!generatedPrompt || !content))}
        className="w-full mt-2"
      >
        {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Генерация...</> : <><Sparkles className="mr-2 h-4 w-4" />Сгенерировать изображение</>}
      </Button>
      
      {generatedImages.length > 0 && (
        <div className="mt-4 space-y-4">
          <h3 className="text-base font-semibold">Сгенерированные изображения</h3>
          <div className={`grid ${generatedImages.length > 2 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 generated-images-grid`}>
            {generatedImages.map((imageUrl, index) => (
              <div 
                key={index}
                className={`relative rounded-md overflow-hidden border-2 cursor-pointer ${selectedImageIndex === index ? 'border-primary' : 'border-transparent'}`}
                onClick={() => handleSelectImage(index)}
              >
                <div className="w-full aspect-square bg-gray-100 flex items-center justify-center relative">
                  <img 
                    src={imageUrl} 
                    alt={`Изображение ${index + 1}`} 
                    className="w-full h-auto object-cover aspect-square"
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                </div>
              </div>
            ))}
          </div>
          
          <div className="flex justify-between mt-2">
            <Button variant="outline" size="sm" onClick={() => generateImage()}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Ещё
            </Button>
            <Button size="sm" onClick={confirmSelection} disabled={selectedImageIndex < 0}>
              <Image className="mr-1 h-3 w-3" />
              Использовать
            </Button>
          </div>
        </div>
      )}

      </div>
    </DialogContent>
  );
}
