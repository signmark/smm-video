import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";

interface Platform {
  id: string;
  name: string;
  value: string;
  icon: React.ReactNode;
  checked: boolean;
}

const DEFAULT_PROMPT = `Найди TOP-5 самых популярных и авторитетных аккаунтов в Instagram и Telegram по теме: {keyword}

Для каждого аккаунта укажи:
1. Имя пользователя с символом @
2. Полное название на русском языке
3. Количество подписчиков с буквами K или M
4. Краткое описание на русском языке

Формат для Instagram аккаунтов:
**@username** - Название (500K подписчиков) - Описание контента
https://www.instagram.com/username/ - дополнительная информация

Формат для Telegram каналов:
**@username** - Название (500K подписчиков) - Описание контента
https://t.me/username/ - дополнительная информация

Результаты должны быть точными, актуальными и с реальными данными. Приоритет отдавай каналам с наибольшим числом подписчиков.`;

/**
 * Диалог поиска источников для кампании с возможностью выбора платформ и настройки промпта.
 */
export function SourcesSearchDialog({
  campaignId,
  keyword,
  onClose,
  onSearch,
  open,
  onOpenChange
}: {
  campaignId: string;
  keyword: string;
  onClose: () => void;
  onSearch: (sources: any[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT.replace('{keyword}', keyword));
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  
  const [platforms, setPlatforms] = useState<Platform[]>([
    {
      id: "instagram",
      name: "Instagram",
      value: "instagram",
      icon: <span className="mr-2 text-pink-500">📸</span>,
      checked: true
    },
    {
      id: "telegram",
      name: "Telegram",
      value: "telegram",
      icon: <span className="mr-2 text-blue-500">📱</span>,
      checked: true
    },
    {
      id: "vkontakte",
      name: "ВКонтакте",
      value: "vkontakte",
      icon: <span className="mr-2 text-blue-600">🌐</span>,
      checked: false
    },
    {
      id: "facebook",
      name: "Facebook",
      value: "facebook",
      icon: <span className="mr-2 text-blue-700">👥</span>,
      checked: false
    },
    {
      id: "youtube",
      name: "YouTube",
      value: "youtube",
      icon: <span className="mr-2 text-red-600">📺</span>,
      checked: false
    }
  ]);

  const handleCheckboxChange = (id: string) => {
    setPlatforms(platforms.map(platform => 
      platform.id === id ? { ...platform, checked: !platform.checked } : platform
    ));
  };

  const handleSearch = async () => {
    const selectedPlatforms = platforms.filter(p => p.checked).map(p => p.value);
    




    
    if (selectedPlatforms.length === 0) {

      toast({
        title: "Выберите платформы",
        description: "Пожалуйста, выберите хотя бы одну платформу для поиска",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      // Проверка статуса API ключей для отладки
      try {
        const keysStatus = await apiRequest('/api/debug/api-keys');
        console.log("📊 Статус API ключей:", keysStatus);
        
        // Проверяем есть ли ключ Perplexity - ОБНОВЛЕНО: пропускаем эту проверку,
      // так как ключи есть в Directus, и мы полагаемся на серверную проверку
      if (keysStatus?.data?.serviceResults) {
        // Проверка наличия ключа в массиве результатов
        const perplexityKey = keysStatus.data.serviceResults.find(
          (service: any) => service.service === 'perplexity'
        );
        
        console.log("🔑 Информация о ключе Perplexity:", perplexityKey);
        
        // Отключаем блокирующую проверку, пусть запрос пройдёт на сервер 
        // который сам найдет ключ в БД
        if (perplexityKey && !perplexityKey.keyExists) {
          console.log("⚠️ API ключ Perplexity может отсутствовать, но продолжаем поиск");
        }
      } else {
        console.log("⚠️ Неожиданный формат ответа API ключей:", keysStatus?.data);
      }
      } catch (keyError) {
        console.log("❌ Ошибка при проверке API ключей:", keyError);
        // Продолжаем выполнение даже при ошибке проверки ключей
      }

      // Получаем текущий токен авторизации
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        console.error("❌ Ошибка авторизации: отсутствует токен в localStorage");
        toast({
          title: "Ошибка авторизации",
          description: "Необходимо войти в систему. Пожалуйста, обновите страницу и авторизуйтесь снова.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }
      
      console.log("🔑 Токен авторизации (первые 10 символов):", authToken.substring(0, 10) + "...");
      
      console.log("📝 Запрос к API:");
      console.log({
        endpoint: "/api/sources/search",
        method: "POST",
        data: {
          keyword,
          campaignId,
          platforms: selectedPlatforms,
          customPrompt: isPromptOpen ? prompt : undefined
        }
      });
      
      const response = await apiRequest(`/api/sources/search`, {
        method: "POST",
        data: {
          keyword,
          campaignId,
          platforms: selectedPlatforms,
          customPrompt: isPromptOpen ? prompt : undefined
        },
        headers: {
          "Authorization": `Bearer ${authToken}`
        }
      });

      console.log("✅ Ответ от API:", response);

      if (response.data?.sources) {
        console.log(`🎯 Найдено ${response.data.sources.length} источников`);
        onSearch(response.data.sources);
      } else {
        console.log("❌ Ошибка: нет источников в ответе", response);
        
        // Информативное сообщение об ошибке в зависимости от конкретной причины
        let errorMessage = response.error || "Не удалось найти источники, попробуйте другие ключевые слова";
        if (response.error?.includes("API ключ Perplexity")) {
          errorMessage = "Для поиска источников необходимо настроить API ключ Perplexity в настройках учетной записи";
        }
        
        toast({
          title: "Ошибка поиска",
          description: errorMessage,
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("❌ Ошибка поиска источников:", error);
      
      // Информативное сообщение об ошибке
      let errorMessage = "Произошла ошибка при поиске источников. Пожалуйста, попробуйте позже.";
      if (error instanceof Error) {
        if (error.message.includes("401")) {
          errorMessage = "Ошибка авторизации. Пожалуйста, войдите в систему снова.";
        } else if (error.message.includes("API ключ") || error.message.includes("Perplexity")) {
          errorMessage = "Для поиска источников необходим API ключ Perplexity. Проверьте настройки учетной записи.";
        }
      }
      
      toast({
        title: "Ошибка",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Выберите социальные сети для поиска источников</DialogTitle>
          <DialogDescription>
            Выберите платформы, на которых будем искать источники по запросу: <strong>{keyword}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {platforms.map((platform) => (
            <div key={platform.id} className="flex items-center space-x-2">
              <Checkbox 
                id={platform.id} 
                checked={platform.checked} 
                onCheckedChange={() => handleCheckboxChange(platform.id)}
              />
              <Label htmlFor={platform.id} className="flex items-center cursor-pointer">
                {platform.icon} {platform.name}
              </Label>
            </div>
          ))}

          <div className="mt-6">
            <Popover open={isPromptOpen} onOpenChange={setIsPromptOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={isPromptOpen}
                  className="w-full justify-between"
                >
                  Настроить промпт
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[550px] p-0">
                <div className="p-4 space-y-4">
                  <Label htmlFor="prompt">Промпт для Perplexity API</Label>
                  <Textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={12}
                    className="w-full"
                    placeholder="Введите промпт для поиска источников"
                  />
                  <div className="flex justify-between">
                    <Button 
                      variant="outline" 
                      onClick={() => setPrompt(DEFAULT_PROMPT.replace('{keyword}', keyword))}
                      size="sm"
                    >
                      Сбросить
                    </Button>
                    <Button onClick={() => setIsPromptOpen(false)} size="sm">
                      Применить
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button onClick={handleSearch} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Поиск источников...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Искать источники
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}