import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Platform {
  id: string;
  name: string;
  value: string;
  icon: React.ReactNode;
  checked: boolean;
}

/**
 * Диалог поиска источников по всем ключевым словам кампании
 */
export function CampaignSourcesSearchDialog({
  campaignId,
  onClose,
  onSearch,
  open,
  onOpenChange
}: {
  campaignId: string;
  onClose: () => void;
  onSearch: (sources: any[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordResults, setKeywordResults] = useState<Record<string, number>>({});
  const [foundSources, setFoundSources] = useState<any[]>([]);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [platform, setPlatform] = useState<string>("instagram");
  
  const platforms: Platform[] = [
    {
      id: "instagram",
      name: "Instagram",
      value: "instagram",
      icon: <span className="mr-2 text-pink-500">📸</span>,
      checked: platform === "instagram"
    },
    {
      id: "telegram",
      name: "Telegram",
      value: "telegram",
      icon: <span className="mr-2 text-blue-500">📱</span>,
      checked: platform === "telegram"
    }
  ];
  
  const handlePlatformChange = (platformId: string) => {
    setPlatform(platformId);
  };
  
  const handleSearch = async () => {
    setIsLoading(true);
    setHasError(false);
    setErrorMessage("");
    setFoundSources([]);
    setKeywords([]);
    setKeywordResults({});
    
    try {
      const response = await apiRequest("/api/sources/search-by-campaign", {
        method: "POST",
        data: {
          campaignId,
          platform,
          maxResults: 30
        }
      });
      
      if (response.success) {
        setFoundSources(response.data || []);
        setKeywords(response.keywords || []);
        setKeywordResults(response.keywordResults || {});
        
        // Если источники найдены, передаем их в родительский компонент
        if ((response.data || []).length > 0) {
          onSearch(response.data);
        } else {
          toast({
            title: "Источники не найдены",
            description: response.message || "По заданным параметрам не найдено источников",
          });
        }
      } else {
        setHasError(true);
        setErrorMessage(response.error || "Ошибка поиска источников");
        toast({
          title: "Ошибка поиска источников",
          description: response.error || "Не удалось выполнить поиск",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error searching sources by campaign:", error);
      setHasError(true);
      setErrorMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      toast({
        title: "Ошибка поиска источников",
        description: "Не удалось выполнить запрос к API",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Отображение найденных ключевых слов и числа источников для каждого
  const renderKeywordResults = () => {
    if (keywords.length === 0) return null;
    
    return (
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ключевые слова кампании</CardTitle>
          <CardDescription>Количество найденных источников для каждого ключевого слова</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[150px] pr-4">
            <div className="space-y-2">
              {keywords.map((keyword) => (
                <div key={keyword} className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
                  <span className="font-medium">{keyword}</span>
                  <span className="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    {keywordResults[keyword] || 0}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Поиск источников по кампании</DialogTitle>
          <DialogDescription>
            Поиск будет выполнен по всем ключевым словам кампании на выбранной платформе.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-4">
            <h4 className="font-medium">Выберите платформу</h4>
            <div className="grid grid-cols-2 gap-4">
              {platforms.map((p) => (
                <div key={p.id} className="flex items-center space-x-2">
                  <Checkbox 
                    id={p.id} 
                    checked={platform === p.id}
                    onCheckedChange={() => handlePlatformChange(p.id)}
                  />
                  <Label htmlFor={p.id} className="flex items-center cursor-pointer">
                    {p.icon} {p.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          
          {hasError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Ошибка</AlertTitle>
              <AlertDescription>
                {errorMessage || "Произошла ошибка при поиске источников"}
              </AlertDescription>
            </Alert>
          )}
          
          {renderKeywordResults()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSearch} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Поиск...
              </>
            ) : (
              <>Найти источники</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}