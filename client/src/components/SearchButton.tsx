import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, ListChecks } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog } from "@/components/ui/dialog";
import { NewSourcesDialog } from "@/components/NewSourcesDialog";
import { SourcesSearchDialog } from "@/components/SourcesSearchDialog";
import { CampaignSourcesSearchDialog } from "@/components/CampaignSourcesSearchDialog";

/**
 * Кнопка поиска источников для кампании.
 * 
 * ВАЖНО: Эта кнопка отвечает за поиск новых источников (аккаунтов/каналов) 
 * через Perplexity API. Не путать с функцией "Собрать тренды", которая
 * использует n8n webhook для получения трендовых постов.
 * 
 * Процесс работы:
 * 1. Открывает диалог выбора социальных сетей и настройки промптов
 * 2. Отправляет запрос на сервер (/api/sources/search)
 * 3. Результаты отображаются в диалоговом окне NewSourcesDialog
 */
interface SearchButtonProps {
  campaignId: string;  // ID кампании, для которой выполняется поиск
  keywords: Array<{ keyword: string }>;  // Ключевые слова для поиска источников
}

export function SearchButton({ campaignId, keywords }: SearchButtonProps) {
  // Состояние загрузки для показа спиннера и блокировки кнопки
  const [isLoading, setIsLoading] = useState(false);
  // Управление видимостью диалогов
  const [isDialogOpen, setIsDialogOpen] = useState(false); // Диалог с результатами
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false); // Диалог выбора соцсетей
  const [isCampaignSearchDialogOpen, setIsCampaignSearchDialogOpen] = useState(false); // Диалог поиска по всей кампании
  // Выбранное ключевое слово для поиска
  const [selectedKeyword, setSelectedKeyword] = useState("");
  // Данные полученных источников от API
  const [sourcesData, setSourcesData] = useState<{data: {sources: any[]}} | null>(null);
  const { toast } = useToast();

  // Открытие диалога для выбора социальных сетей и настройки промпта
  const openSearchDialog = () => {
    if (!keywords.length) {
      toast({
        title: "Ошибка",
        description: "Добавьте ключевые слова для поиска",
        variant: "destructive"
      });
      return;
    }
    
    // Используем первое ключевое слово как стартовое
    setSelectedKeyword(keywords[0].keyword);
    setIsSearchDialogOpen(true);
  };

  // Обработчик результатов поиска
  const handleSearchResults = (sources: any[]) => {
    setSourcesData({
      data: {
        sources: sources
      }
    });
    setIsSearchDialogOpen(false);
    setIsDialogOpen(true);
  };

  // Открывает диалог поиска источников по всем ключевым словам кампании
  const openCampaignSearchDialog = () => {
    if (!keywords.length) {
      toast({
        title: "Ошибка",
        description: "Добавьте ключевые слова для поиска",
        variant: "destructive"
      });
      return;
    }
    
    setIsCampaignSearchDialogOpen(true);
  };

  return (
    <>
      <div className="flex space-x-2">
        <Button onClick={openSearchDialog} disabled={isLoading}>
          {isLoading ? (
            <>
              <div className="flex items-center">
                <svg 
                  className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24"
                >
                  <circle 
                    className="opacity-25" 
                    cx="12" 
                    cy="12" 
                    r="10" 
                    stroke="currentColor" 
                    strokeWidth="4"
                  />
                  <path 
                    className="opacity-75" 
                    fill="currentColor" 
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Поиск источников...</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <Search className="mr-1 h-4 w-4" />
                <span>Искать упоминания</span>
                <span className="ml-1 text-xs bg-gray-200 dark:bg-gray-700 rounded px-1.5 py-0.5" title="Использует Perplexity API">
                  API
                </span>
              </div>
            </>
          )}
        </Button>

        <Button 
          onClick={openCampaignSearchDialog} 
          disabled={isLoading} 
          variant="outline"
          title="Поиск источников по всем ключевым словам кампании"
        >
          <div className="flex items-center gap-1">
            <ListChecks className="mr-1 h-4 w-4" />
            <span>Поиск по всем словам</span>
          </div>
        </Button>
      </div>

      {/* Диалог для выбора социальных сетей и настройки промпта */}
      <SourcesSearchDialog
        campaignId={campaignId}
        keyword={selectedKeyword}
        onClose={() => setIsSearchDialogOpen(false)}
        onSearch={handleSearchResults}
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
      />

      {/* Диалог для поиска по всем ключевым словам кампании */}
      <CampaignSourcesSearchDialog
        campaignId={campaignId}
        onClose={() => setIsCampaignSearchDialogOpen(false)}
        onSearch={handleSearchResults}
        open={isCampaignSearchDialogOpen}
        onOpenChange={setIsCampaignSearchDialogOpen}
      />

      {/* Диалог для отображения результатов */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {sourcesData && (
          <NewSourcesDialog
            campaignId={campaignId}
            onClose={() => setIsDialogOpen(false)}
            sourcesData={sourcesData}
          />
        )}
      </Dialog>
    </>
  );
}

export default SearchButton;