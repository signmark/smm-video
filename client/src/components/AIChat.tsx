import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageCircle, 
  X, 
  Send, 
  Sparkles, 
  FileText, 
  Calendar,
  Image,
  Loader2,
  Bot,
  User,
  Trash2,
  Check,
  Play,
  ArrowRight,
  TrendingUp,
  Target,
  Share2,
  Mic,
  MicOff
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/store";
import { useCampaignStore } from "@/lib/campaignStore";
import { queryClient } from "@/lib/queryClient";
import { useCampaignDetail } from "@/hooks/use-campaigns";
import { useLocation } from "wouter";

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
  interactive?: {
    type: 'platform-selector' | 'campaign-options' | 'welcome-tutorial';
    platforms?: Array<{
      id: string;
      name: string;
      enabled: boolean;
      icon?: string;
    }>;
    campaignOptions?: {
      name: string;
      description: string;
      websiteUrl: string;
      options: Array<{
        id: string;
        name: string;
        description: string;
        enabled: boolean;
        icon?: string;
      }>;
    };
    tutorial?: {
      currentStep: number;
      totalSteps: number;
      steps: Array<{
        id: string;
        title: string;
        description: string;
        action: string;
        icon: string;
        example?: string;
        command?: string;
      }>;
    };
    onConfirm?: (selectedPlatforms: string[]) => void;
  };
}

interface CommandSuggestion {
  command: string;
  description: string;
  icon: any;
  example: string;
}

const commandSuggestions: CommandSuggestion[] = [
  {
    command: "создай кампанию",
    description: "Создать новую кампанию с настройками",
    icon: Calendar,
    example: "Создай кампанию с анекдотами по сайту https://www.anekdot.ru/"
  },
  {
    command: "заполни анкету",
    description: "Автоматически заполнить бизнес-анкету",
    icon: FileText,
    example: "Заполни анкету для кафе на Невском проспекте"
  },
  {
    command: "создай посты",
    description: "Генерация серии постов с картинками",
    icon: Image,
    example: "Создай 5 постов про кофе с картинками"
  },
  {
    command: "запланируй публикации", 
    description: "Автоматическое планирование в соцсети",
    icon: Calendar,
    example: "Запланируй эти посты в Instagram и VK на завтра"
  },
  {
    command: "перейди в контент",
    description: "Навигация: открыть любой раздел приложения",
    icon: ArrowRight,
    example: "Перейди в контент"
  },
  {
    command: "автономный режим",
    description: "AI сам генерирует и публикует контент без участия",
    icon: Bot,
    example: "Запусти автономный режим каждые 6 часов по 2 поста"
  }
];

// Функция для форматирования markdown в HTML
const formatMarkdown = (text: string): string => {
  return text
    // Жирный текст **text** -> <strong>text</strong>
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Курсив *text* -> <em>text</em>
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Код `text` -> <code>text</code>
    .replace(/`(.*?)`/g, '<code class="bg-muted px-1 rounded text-xs">$1</code>')
    // Ссылки [text](url) -> <a>text</a>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline" target="_blank" rel="noopener noreferrer">$1</a>');
};

interface AIChatProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showFloatingButton?: boolean;
  hideHeader?: boolean;
  fullScreen?: boolean;
}

export function AIChat({ isOpen: externalIsOpen, onOpenChange, showFloatingButton = true, hideHeader = false, fullScreen = false }: AIChatProps = {}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  
  // Используем внешнее состояние если передано, иначе внутреннее
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsOpen = (value: boolean) => {
    if (onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalIsOpen(value);
    }
  };
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();
  const { userId } = useAuthStore();
  const { selectedCampaignId, selectedCampaignName, setSelectedCampaign } = useCampaignStore();
  const [, setLocation] = useLocation();
  
  // Название кампании, если его нет в store.
  // Ключ был ['/api/campaigns', selectedCampaignId] — тот же, что у топбара, но с
  // другим queryFn (там дефолтный, тянущий список). Два разных URL под одним
  // ключом — источник и лишних запросов, и данных не той формы. Теперь общий хук.
  const { data: campaignData } = useCampaignDetail(
    selectedCampaignId && !selectedCampaignName ? selectedCampaignId : null,
  );

  // Обновляем store когда получили название
  useEffect(() => {
    if (campaignData?.name && selectedCampaignId && !selectedCampaignName) {
      setSelectedCampaign(selectedCampaignId, campaignData.name);
    }
  }, [campaignData, selectedCampaignId, selectedCampaignName, setSelectedCampaign]);

  // Отображаемое название
  const displayCampaignName = selectedCampaignName || campaignData?.name;

  // Маппинг навигационных команд на URL (все реальные страницы приложения)
  const navigationMap: Record<string, { path: string; name: string }> = {
    'контент': { path: '/content', name: 'Контент' },
    'кампании': { path: '/campaigns', name: 'Кампании' },
    'аналитика': { path: '/analytics', name: 'Аналитика' },
    'публикации': { path: '/publish/scheduled', name: 'Запланированные публикации' },
    'календарь': { path: '/publish/calendar', name: 'Календарь публикаций' },
    'тренды': { path: '/trends', name: 'Тренды' },
    'главная': { path: '/dashboard', name: 'Главная' },
    'главную': { path: '/dashboard', name: 'Главная' },
    'дашборд': { path: '/dashboard', name: 'Главная' },
    'истории': { path: '/stories', name: 'Stories' },
    'видео': { path: '/video', name: 'Видеоредактор' },
    'видеоредактор': { path: '/video', name: 'Видеоредактор' },
    'ключевые слова': { path: '/keywords', name: 'Ключевые слова' },
    'ключевых слов': { path: '/keywords', name: 'Ключевые слова' },
    'посты': { path: '/posts', name: 'Посты' },
    'постов': { path: '/posts', name: 'Посты' },
    'помощь': { path: '/help', name: 'Помощь' },
    'инструкции': { path: '/help/tutorials', name: 'Видеоинструкции' },
    'видеоинструкции': { path: '/help/tutorials', name: 'Видеоинструкции' },
    'настройки': { path: '/settings/instagram-setup', name: 'Настройки' },
    'instagram': { path: '/settings/instagram-setup', name: 'Настройка Instagram' },
    'инстаграм': { path: '/settings/instagram-setup', name: 'Настройка Instagram' },
    'задачи': { path: '/tasks', name: 'Задачи' },
    'задач': { path: '/tasks', name: 'Задачи' },
    'источники': { path: '/trends', name: 'Источники и тренды' },
    'источников': { path: '/trends', name: 'Источники и тренды' },
    // Анкета доступна только если выбрана кампания
    ...(selectedCampaignId ? {
      'анкета': { path: `/business-questionnaire/${selectedCampaignId}`, name: 'Бизнес-анкета' },
      'анкету': { path: `/business-questionnaire/${selectedCampaignId}`, name: 'Бизнес-анкета' }
    } : {}),
    'api ключи': { path: '/admin/global-api-keys', name: 'Глобальные API ключи' },
    'ключи': { path: '/admin/global-api-keys', name: 'Глобальные API ключи' },
    'пользователи': { path: '/admin/users', name: 'Управление пользователями' },
    'пользователей': { path: '/admin/users', name: 'Управление пользователями' },
    'админ': { path: '/admin/users', name: 'Админ панель' },
    'админка': { path: '/admin/users', name: 'Админ панель' }
  };

  // Ключ для localStorage (уникальный для каждого пользователя и кампании)
  const getStorageKey = () => {
    return `ai-chat-history-${userId}-${selectedCampaignId || 'default'}`;
  };

  // Загрузка истории сообщений из localStorage
  const loadMessagesFromStorage = () => {
    try {
      const storageKey = getStorageKey();
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsedMessages = JSON.parse(saved).map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        return parsedMessages;
      }
    } catch (error) {
      console.error('Ошибка загрузки истории чата:', error);
    }
    return [];
  };

  // Сохранение истории сообщений в localStorage
  const saveMessagesToStorage = (newMessages: Message[]) => {
    try {
      const storageKey = getStorageKey();
      localStorage.setItem(storageKey, JSON.stringify(newMessages));
    } catch (error) {
      console.error('Ошибка сохранения истории чата:', error);
    }
  };

  // Очистка истории чата
  const clearChatHistory = () => {
    try {
      const storageKey = getStorageKey();
      localStorage.removeItem(storageKey);
      setMessages([{
        id: '1',
        type: 'assistant',
        content: 'Привет! Я ваш AI-помощник. Чем могу помочь?',
        timestamp: new Date()
      }]);
      toast({
        title: "История очищена",
        description: "История диалога была успешно очищена",
        duration: 2000,
      });
    } catch (error) {
      console.error('Ошибка очистки истории чата:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  // Загружаем историю при первом открытии чата
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const savedMessages = loadMessagesFromStorage();
      if (savedMessages.length > 0) {
        setMessages(savedMessages);
      } else {
        // Добавляем приветственное сообщение только при первом открытии
        const welcomeMessage = [{
          id: '1',
          type: 'assistant' as const,
          content: '👋 Добро пожаловать! Я ваш AI-помощник для SMM.\n\n🚀 **Хотите быстро начать?** Могу провести вас по всему процессу создания кампании!\n\n✨ Напишите **"туториал"** для пошагового обучения или задайте любой вопрос.',
          timestamp: new Date()
        }];
        setMessages(welcomeMessage);
        saveMessagesToStorage(welcomeMessage);
      }
    }
  }, [isOpen, messages.length]);

  // Сохраняем сообщения при их изменении
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesToStorage(messages);
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
      status: 'sent'
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputValue.trim().toLowerCase();
    setInputValue('');

    // Проверка навигационных команд
    // Строгая проверка: команда должна начинаться с навигационного слова и содержать название раздела
    const navigationKeywords = ['перейди', 'открой', 'иди', 'переход'];
    const startsWithNavigation = navigationKeywords.some(keyword => 
      currentInput.startsWith(keyword) || currentInput.startsWith(`${keyword} в`) || currentInput.startsWith(`${keyword} на`)
    );
    
    // Проверяем, содержится ли название раздела из navigationMap
    let foundNavigationTarget = false;
    let navigationKey = '';
    for (const key of Object.keys(navigationMap)) {
      if (currentInput.includes(key)) {
        foundNavigationTarget = true;
        navigationKey = key;
        break;
      }
    }
    
    const isNavigationCommand = startsWithNavigation && foundNavigationTarget;
    
    if (isNavigationCommand) {
      // Ищем совпадение с навигационной картой
      for (const [key, value] of Object.entries(navigationMap)) {
        if (currentInput.includes(key)) {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            type: 'assistant',
            content: `✅ Перехожу в раздел "${value.name}"`,
            timestamp: new Date(),
            status: 'sent'
          };
          
          setMessages(prev => [...prev, assistantMessage]);
          
          // Небольшая задержка для UX
          setTimeout(() => {
            setLocation(value.path);
            setIsOpen(false); // Закрываем чат после перехода
          }, 500);
          
          return;
        }
      }
      
      // Если не нашли совпадение - показываем уникальные разделы
      const uniqueSections = Array.from(
        new Map(
          Object.entries(navigationMap).map(([key, val]) => [val.path, { key, val }])
        ).values()
      );
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: '❌ Не могу найти такой раздел. Доступные разделы:\n\n' + 
          uniqueSections
            .map(({ key, val }) => `• ${val.name} - скажите "перейди в ${key}"`)
            .join('\n'),
        timestamp: new Date(),
        status: 'sent'
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      return;
    }

    setIsLoading(true);

    try {
      // Берем последние 10 сообщений для контекста + текущее сообщение пользователя
      // ВАЖНО: setMessages не обновляет состояние синхронно, поэтому берем старый массив и добавляем userMessage
      const allMessages = [...messages, userMessage];
      const recentMessages = allMessages.slice(-10).map(msg => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: msg.timestamp
      }));
      
      // Отправляем запрос к AI-помощнику
      const response = await fetch('/api/ai-assistant/process-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          message: currentInput,
          userId,
          campaignId: selectedCampaignId,
          chatHistory: recentMessages // Добавляем историю диалога
        })
      });

      if (!response.ok) {
        throw new Error('Ошибка при обработке команды');
      }

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: data.response || 'Команда обработана успешно!',
        timestamp: new Date(),
        status: 'sent',
        interactive: data.interactive // Добавляем интерактивные элементы
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Если есть действие, показываем успешное уведомление и инвалидируем кэш
      if (data.action) {
        toast({
          title: "Команда выполнена",
          description: data.action,
          duration: 3000,
        });

        // Инвалидируем соответствующие кэши в зависимости от типа действия
        if (data.action.includes('Анкета') || data.action.includes('анкета')) {
          // Инвалидируем кэш анкеты
          queryClient.invalidateQueries({ 
            queryKey: ['business-questionnaire', selectedCampaignId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['/api/campaigns', selectedCampaignId, 'questionnaire'] 
          });
        }
        
        if (data.action.includes('пост') || data.action.includes('контент')) {
          // Инвалидируем кэш контента
          queryClient.invalidateQueries({ 
            queryKey: ['/api/campaign-content', selectedCampaignId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['campaign-content', selectedCampaignId] 
          });
        }

        if (data.action.includes('кампани')) {
          // Инвалидируем кэш кампаний
          queryClient.invalidateQueries({ 
            queryKey: ['/api/campaigns'] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['/api/campaigns', userId] 
          });
          
          // AI-77: вместо window.location.reload() — инвалидируем кэш и навигируем через SPA
          if (data.response && data.response.includes('создана') && data.response.includes('🆔 ID кампании:')) {
            // Извлекаем ID кампании из ответа для навигации
            const idMatch = data.response.match(/🆔 ID кампании:\s*(\S+)/);
            const campaignId = idMatch ? idMatch[1] : null;
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
              queryClient.invalidateQueries({ queryKey: ['/api/campaign-content'] });
              if (campaignId) {
                setLocation(`/campaigns/${campaignId}`);
              }
            }, 2000);
          }
        }

        if (data.action.includes('Stories') || data.action.includes('stories')) {
          // Инвалидируем кэш Stories
          queryClient.invalidateQueries({ 
            queryKey: ['/api/campaign-content', selectedCampaignId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['story'] 
          });
        }

        if (data.action.includes('тренд') || data.action.includes('анализ')) {
          // Инвалидируем кэш трендов и аналитики
          queryClient.invalidateQueries({ 
            queryKey: ['trends', selectedCampaignId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['analytics', selectedCampaignId] 
          });
        }
      }

    } catch (error) {
      console.error('Ошибка AI-чата:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Извините, произошла ошибка при обработке вашего запроса. Попробуйте еще раз или уточните команду.',
        timestamp: new Date(),
        status: 'error'
      };

      setMessages(prev => [...prev, errorMessage]);
      
      toast({
        title: "Ошибка",
        description: "Не удалось обработать команду",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSuggestionClick = (suggestion: CommandSuggestion) => {
    setInputValue(suggestion.example);
    inputRef.current?.focus();
  };

  // Инициализация Web Speech API
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'ru-RU'; // Русский язык по умолчанию
      
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(prev => prev + (prev ? ' ' : '') + transcript);
        setIsRecording(false);
      };
      
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        toast({
          title: "Ошибка голосового ввода",
          description: event.error === 'no-speech' 
            ? "Не удалось распознать речь. Попробуйте еще раз."
            : "Произошла ошибка при распознавании речи.",
          variant: "destructive",
          duration: 3000,
        });
      };
      
      recognition.onend = () => {
        setIsRecording(false);
      };
      
      recognitionRef.current = recognition;
    }
  }, [toast]);

  // Управление голосовым вводом
  const handleVoiceInput = () => {
    if (!recognitionRef.current) {
      toast({
        title: "Голосовой ввод недоступен",
        description: "Ваш браузер не поддерживает голосовой ввод. Попробуйте Chrome или Edge.",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        // Убрано навязчивое уведомление - статус видно по кнопке микрофона
      } catch (error) {
        console.error('Voice input error:', error);
        setIsRecording(false);
      }
    }
  };

  // Компонент для выбора опций создания кампании
  const CampaignOptionsSelector = ({ interactive, messageId }: { interactive: any; messageId: string }) => {
    const campaignOptions = interactive.campaignOptions;
    const [selectedOptions, setSelectedOptions] = useState<string[]>(
      campaignOptions.options.filter((opt: any) => opt.enabled).map((opt: any) => opt.id)
    );

    const handleOptionToggle = (optionId: string) => {
      setSelectedOptions(prev => 
        prev.includes(optionId) 
          ? prev.filter(id => id !== optionId)
          : [...prev, optionId]
      );
    };

    const handleConfirm = async () => {
      // Обновляем сообщение, убирая интерактивность
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, interactive: undefined, content: `Создаю кампанию "${campaignOptions.name}" с опциями: ${selectedOptions.join(', ')}` }
          : msg
      ));

      // Отправляем команду с выбранными опциями
      const selectedOptionsData = {
        websiteAnalysis: selectedOptions.includes('website-analysis'),
        keywords: selectedOptions.includes('keywords'),
        findSources: selectedOptions.includes('find-sources'),
        collectTrends: selectedOptions.includes('collect-trends'),
        contentPlan: selectedOptions.includes('content-plan')
      };
      
      const response = await fetch('/api/ai-assistant/process-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          message: `Создай полную кампанию "${campaignOptions.name}" по сайту ${campaignOptions.websiteUrl} с выбранными опциями`,
          userId,
          campaignId: selectedCampaignId,
          campaignOptions: {
            name: campaignOptions.name,
            description: campaignOptions.description,
            websiteUrl: campaignOptions.websiteUrl,
            selectedOptions: selectedOptionsData
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: Message = {
          id: Date.now().toString(),
          type: 'assistant',
          content: data.response || 'Кампания создается!',
          timestamp: new Date(),
          status: 'sent'
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    };

    const optionIcons: { [key: string]: string } = {
      'website-analysis': '🔍',
      'keywords': '🔑',
      'find-sources': '🌐',
      'collect-trends': '📈',
      'content-plan': '📝'
    };

    return (
      <div className="bg-muted/50 rounded-lg p-3 mt-2 border">
        <h4 className="font-medium text-sm mb-2">🎯 Настройки создания кампании:</h4>
        <div className="mb-3 p-2 bg-background/50 rounded border-l-4 border-primary">
          <div className="text-sm font-medium">{campaignOptions.name}</div>
          <div className="text-xs text-muted-foreground">{campaignOptions.description}</div>
          <div className="text-xs text-muted-foreground mt-1">Сайт: {campaignOptions.websiteUrl}</div>
        </div>
        <div className="space-y-2 mb-3">
          {campaignOptions.options.map((option: any) => {
            // Скрываем опцию анализа сайта
            if (option.id === 'website-analysis') return null;
            
            return (
              <div key={option.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`option-${option.id}`}
                  checked={selectedOptions.includes(option.id)}
                  onCheckedChange={() => handleOptionToggle(option.id)}
                  data-testid={`checkbox-option-${option.id}`}
                />
                <label 
                  htmlFor={`option-${option.id}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                >
                  <span>{optionIcons[option.id] || '📋'}</span>
                  <div>
                    <div>{option.name}</div>
                    <div className="text-xs text-muted-foreground">{option.description}</div>
                  </div>
                </label>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleConfirm}
            disabled={selectedOptions.length === 0}
            size="sm"
            className="flex-1"
            data-testid="button-confirm-campaign-options"
          >
            <Check className="h-3 w-3 mr-1" />
            Создать кампанию ({selectedOptions.length})
          </Button>
        </div>
      </div>
    );
  };

  // Компонент для интерактивного выбора платформ
  const PlatformSelector = ({ interactive, messageId }: { interactive: any; messageId: string }) => {
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(
      interactive.platforms.filter((p: any) => p.enabled).map((p: any) => p.id)
    );

    const handlePlatformToggle = (platformId: string) => {
      setSelectedPlatforms(prev => 
        prev.includes(platformId) 
          ? prev.filter(id => id !== platformId)
          : [...prev, platformId]
      );
    };

    const handleConfirm = async () => {
      // Обновляем сообщение, убирая интерактивность
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, interactive: undefined, content: `Выбранные платформы: ${selectedPlatforms.join(', ')}` }
          : msg
      ));

      // Отправляем команду с выбранными платформами
      const response = await fetch('/api/ai-assistant/process-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          message: `собери тренды для платформ: ${selectedPlatforms.join(', ')}`,
          userId,
          campaignId: selectedCampaignId,
          selectedPlatforms
        })
      });

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: Message = {
          id: Date.now().toString(),
          type: 'assistant',
          content: data.response || 'Сбор трендов запущен!',
          timestamp: new Date(),
          status: 'sent'
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    };

    const platformIcons: { [key: string]: string } = {
      vk: '🟦',
      telegram: '📱', 
      instagram: '📷',
      facebook: '👤',
      youtube: '📺'
    };

    return (
      <div className="bg-muted/50 rounded-lg p-3 mt-2 border">
        <h4 className="font-medium text-sm mb-2">📊 Выберите платформы для сбора трендов:</h4>
        <div className="space-y-2 mb-3">
          {interactive.platforms.map((platform: any) => (
            <div key={platform.id} className="flex items-center space-x-2">
              <Checkbox
                id={`platform-${platform.id}`}
                checked={selectedPlatforms.includes(platform.id)}
                onCheckedChange={() => handlePlatformToggle(platform.id)}
                data-testid={`checkbox-platform-${platform.id}`}
              />
              <label 
                htmlFor={`platform-${platform.id}`}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
              >
                <span>{platformIcons[platform.id] || '📱'}</span>
                {platform.name}
              </label>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleConfirm}
            disabled={selectedPlatforms.length === 0}
            size="sm"
            className="flex-1"
            data-testid="button-confirm-platforms"
          >
            <Check className="h-3 w-3 mr-1" />
            Начать сбор ({selectedPlatforms.length})
          </Button>
        </div>
      </div>
    );
  };

  // Компонент приветственного туториала
  const WelcomeTutorial = ({ interactive, messageId }: { interactive: any; messageId: string }) => {
    const tutorial = interactive.tutorial;
    const [currentStep, setCurrentStep] = useState(tutorial.currentStep || 0);
    
    const stepIcons: { [key: string]: any } = {
      'create-campaign': Target,
      'fill-questionnaire': FileText,
      'generate-keywords': TrendingUp,
      'collect-trends': TrendingUp,
      'create-content': Image,
      'schedule-posts': Calendar,
      'analyze-results': TrendingUp
    };

    const handleStepAction = async (step: any) => {
      if (step.command) {
        setInputValue(step.command);
        inputRef.current?.focus();
        
        // Убираем интерактивность из сообщения
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, interactive: undefined, content: `Выполняю шаг: ${step.title}` }
            : msg
        ));
      }
    };

    const handleNextStep = () => {
      if (currentStep < tutorial.totalSteps - 1) {
        setCurrentStep(currentStep + 1);
      }
    };

    const handleSkipTutorial = () => {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, interactive: undefined, content: "Туториал пропущен. Готов к работе! 🚀" }
          : msg
      ));
    };

    const currentStepData = tutorial.steps[currentStep];
    const IconComponent = stepIcons[currentStepData?.id] || Target;

    return (
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg p-4 mt-2 border-2 border-dashed border-purple-300 dark:border-purple-600">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-bold text-sm flex items-center gap-2">
            🎯 Мастер создания кампании
          </h4>
          <Badge variant="outline" className="text-xs">
            {currentStep + 1} из {tutorial.totalSteps}
          </Badge>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4">
          <div 
            className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / tutorial.totalSteps) * 100}%` }}
          />
        </div>

        {/* Current step */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-3 border">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gradient-to-r from-purple-500 to-blue-500 rounded-lg text-white">
              <IconComponent className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h5 className="font-semibold text-sm text-purple-800 dark:text-purple-300 mb-1">
                {currentStepData?.title}
              </h5>
              <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                {currentStepData?.description}
              </p>
              {currentStepData?.example && (
                <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
                  💡 Пример: {currentStepData.example}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {currentStepData?.command && (
                  <Button
                    onClick={() => handleStepAction(currentStepData)}
                    size="sm"
                    className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-xs h-7"
                    data-testid={`button-tutorial-action-${currentStepData.id}`}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    {currentStepData.action}
                  </Button>
                )}
                {currentStep < tutorial.totalSteps - 1 && (
                  <Button
                    onClick={handleNextStep}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    data-testid="button-tutorial-next"
                  >
                    <ArrowRight className="h-3 w-3 mr-1" />
                    Дальше
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* All steps overview */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {tutorial.steps.map((step: any, index: number) => {
            const StepIcon = stepIcons[step.id] || Target;
            const isCompleted = index < currentStep;
            const isCurrent = index === currentStep;
            
            return (
              <div
                key={step.id}
                className={`flex items-center gap-2 p-2 rounded text-xs border ${
                  isCompleted 
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300' 
                    : isCurrent 
                    ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                }`}
              >
                <StepIcon className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{step.title}</span>
                {isCompleted && <Check className="h-3 w-3 text-green-500 ml-auto" />}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            onClick={handleSkipTutorial}
            variant="ghost"
            size="sm"
            className="text-xs text-gray-500 hover:text-gray-700"
            data-testid="button-tutorial-skip"
          >
            Пропустить туториал
          </Button>
          <div className="text-xs text-gray-400 flex items-center">
            💡 Ваш персональный гид по SMM
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) {
    if (!showFloatingButton) {
      return null;
    }
    
    return (
      <div className="fixed bottom-8 right-8 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          size="lg"
          className="h-14 w-14 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
          data-testid="button-open-ai-chat"
        >
          <MessageCircle className="h-6 w-6 text-white" />
        </Button>
      </div>
    );
  }

  return (
    <div className={fullScreen 
      ? "fixed inset-0 z-50" 
      : "fixed bottom-8 right-8 z-50 w-96 max-w-[calc(100vw-4rem)] h-[32rem] max-h-[calc(100vh-4rem)]"
    }>
      <Card className="h-full flex flex-col shadow-2xl border-2 bg-background/95 backdrop-blur-sm">
        {!hideHeader && (
          <CardHeader className="pb-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-white/20 rounded-full">
                  <Sparkles className="h-3 w-3" />
                </div>
                <h3 className="font-semibold text-sm">AI Помощник</h3>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon" 
                  className="h-6 w-6 text-white hover:bg-white/20"
                  onClick={clearChatHistory}
                  title="Сбросить диалог и начать новый контекст"
                  data-testid="button-clear-chat-history"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon" 
                  className="h-6 w-6 text-white hover:bg-white/20"
                  onClick={() => setIsOpen(false)}
                  data-testid="button-close-ai-chat"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
        )}

        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
          {/* Messages Area */}
          <ScrollArea className="flex-1 p-3 h-0">
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg p-2 ${
                      message.type === 'user'
                        ? 'bg-primary text-primary-foreground ml-2'
                        : 'bg-muted mr-2'
                    }`}
                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                  >
                    <div className="flex items-start gap-2">
                      {message.type === 'assistant' && (
                        <Bot className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div 
                          className="text-xs leading-relaxed"
                          style={{ 
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            maxWidth: '100%'
                          }}
                          dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
                        />
                        {/* Интерактивные элементы */}
                        {message.interactive?.type === 'platform-selector' && (
                          <PlatformSelector 
                            interactive={message.interactive} 
                            messageId={message.id}
                          />
                        )}
                        {message.interactive?.type === 'campaign-options' && (
                          <CampaignOptionsSelector 
                            interactive={message.interactive} 
                            messageId={message.id}
                          />
                        )}
                        {message.interactive?.type === 'welcome-tutorial' && (
                          <WelcomeTutorial 
                            interactive={message.interactive} 
                            messageId={message.id}
                          />
                        )}
                        <p className={`text-[10px] mt-0.5 ${
                          message.type === 'user' 
                            ? 'text-primary-foreground/60' 
                            : 'text-muted-foreground'
                        }`}>
                          {message.timestamp.toLocaleTimeString('ru-RU', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Suggestions for first interaction */}
              {messages.length === 1 && messages[0].type === 'assistant' && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground px-2">Популярные команды:</p>
                  {commandSuggestions.map((suggestion, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2 h-auto p-3 hover:bg-muted/50"
                      onClick={() => handleSuggestionClick(suggestion)}
                      data-testid={`suggestion-${index}`}
                    >
                      <suggestion.icon className="h-4 w-4 text-primary" />
                      <div className="text-left flex-1">
                        <p className="font-medium text-sm">{suggestion.command}</p>
                        <p className="text-xs text-muted-foreground">{suggestion.description}</p>
                      </div>
                    </Button>
                  ))}
                </div>
              )}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg p-3 mr-4">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Думаю...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />
          </ScrollArea>

          <Separator />
          
          {/* Input Area */}
          <div className="p-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Напишите что нужно сделать..."
                disabled={isLoading}
                className="flex-1"
                data-testid="input-ai-chat-message"
              />
              <Button
                onClick={handleVoiceInput}
                disabled={isLoading}
                size="icon"
                variant={isRecording ? "destructive" : "outline"}
                className="shrink-0"
                data-testid="button-voice-input"
                title={isRecording ? "Остановить запись" : "Голосовой ввод"}
              >
                {isRecording ? (
                  <MicOff className="h-4 w-4 animate-pulse" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
              <Button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isLoading}
                size="icon"
                className="shrink-0"
                data-testid="button-send-ai-message"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            
            {selectedCampaignId && (
              <div className="flex items-center gap-1 mt-2">
                <Badge variant="secondary" className="text-xs">
                  Кампания: {displayCampaignName || selectedCampaignId.slice(0, 8) + '...'}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}