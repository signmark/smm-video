import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Link, Globe, Search, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { api as apiClient } from "@/lib/api-client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from 'react-i18next';

interface WebsiteKeywordAnalyzerProps {
  campaignId: string;
  onKeywordsSelected?: (keywords: any[]) => void;
}

export function WebsiteKeywordAnalyzer({ campaignId, onKeywordsSelected }: WebsiteKeywordAnalyzerProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [urlStatus, setUrlStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const { toast } = useToast();

  // Фильтр для URL
  const isValidUrl = (text: string) => {
    if (!text.trim()) return false;
    try {
      // Проверяем, что URL содержит домен
      const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(\/.*)?$/;
      return urlPattern.test(text);
    } catch {
      return false;
    }
  };

  // Проверяем URL при каждом изменении
  useEffect(() => {
    // Добавляем небольшую задержку, чтобы не запускать проверку при каждом нажатии клавиши
    const timer = setTimeout(() => {
      if (!url.trim()) {
        setUrlStatus("idle");
      } else if (isValidUrl(url)) {
        setUrlStatus("valid");
      } else {
        setUrlStatus("invalid");
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [url]);

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast({
        title: t('analytics.websiteAnalyzer.urlRequired'),
        variant: "destructive",
      });
      return;
    }

    if (!isValidUrl(url)) {
      toast({
        title: t('analytics.websiteAnalyzer.urlInvalid'),
        description: t('analytics.websiteAnalyzer.urlInvalidDesc'),
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setKeywords([]);
    setSelectedKeywords(new Set());

    // Нормализуем URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      // Используем новый эндпоинт для подбора ключевых слов
      const response = await fetch('/api/keywords/analyze-website', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-locale': localStorage.getItem('language') || 'ru'
        },
        body: JSON.stringify({
          url: normalizedUrl
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || t('analytics.websiteAnalyzer.analysisError'));
      }
      
      if (!data.success || !data.data?.keywords?.length) {
        toast({
          title: t('analytics.websiteAnalyzer.noResults'),
          description: t('analytics.websiteAnalyzer.noResultsDesc'),
        });
        return;
      }

      const extractedKeywords = data.data.keywords.map((kw: any) => ({
        keyword: kw.keyword,
        relevance: kw.relevance,
        category: kw.category,
        trend: kw.trend_score || 50,
        competition: kw.competition || 50
      }));
      
      setKeywords(extractedKeywords);
      
      // Уведомляем пользователя
      toast({
        title: t('analytics.websiteAnalyzer.analysisComplete'),
        description: data.data.note 
          ? t('analytics.websiteAnalyzer.keywordsFoundBasic', { count: extractedKeywords.length })
          : t('analytics.websiteAnalyzer.keywordsFound', { count: extractedKeywords.length }),
      });
    } catch (error) {
      console.error("Website analysis error:", error);
      toast({
        title: t('analytics.websiteAnalyzer.analysisError'),
        description: t('analytics.websiteAnalyzer.analysisErrorDesc'),
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleKeyword = (keyword: string) => {
    const newSelected = new Set(selectedKeywords);
    if (newSelected.has(keyword)) {
      newSelected.delete(keyword);
    } else {
      newSelected.add(keyword);
    }
    setSelectedKeywords(newSelected);
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      // Выбираем все ключевые слова
      const allKeywords = keywords.map((kw) => kw.keyword);
      setSelectedKeywords(new Set(allKeywords));
    } else {
      // Снимаем выделение со всех
      setSelectedKeywords(new Set());
    }
  };

  const handleSaveSelected = async () => {
    if (!campaignId) {
      toast({
        title: t('analytics.websiteAnalyzer.error'),
        description: t('analytics.websiteAnalyzer.selectCampaign'),
        variant: "destructive",
      });
      return;
    }

    if (selectedKeywords.size === 0) {
      toast({
        title: t('analytics.websiteAnalyzer.noSelectedKeywords'),
        description: t('analytics.websiteAnalyzer.selectAtLeastOne'),
        variant: "destructive",
      });
      return;
    }

    try {
      // Получаем полные объекты выбранных ключевых слов
      const selectedKeywordObjects = keywords.filter((kw) => 
        selectedKeywords.has(kw.keyword)
      );

      // Если есть внешний обработчик, вызываем его с выбранными объектами ключевых слов
      if (onKeywordsSelected) {
        onKeywordsSelected(selectedKeywordObjects);
      }
      // В противном случае сохраняем ключевые слова сами
      else {
        // Сначала получаем список существующих ключевых слов для проверки дубликатов
        const existingKeywordsResponse = await apiClient.keywords.list(campaignId);
        const existingKeywords = existingKeywordsResponse.data || [];
        const existingKeywordsLower = existingKeywords.map(k => k.keyword.toLowerCase());
        
        let addedCount = 0;
        let skippedCount = 0;
        
        // Отправляем каждое ключевое слово отдельно
        for (const keyword of selectedKeywordObjects) {
          // Проверяем, существует ли уже такое ключевое слово (независимо от регистра)
          if (existingKeywordsLower.includes(keyword.keyword.toLowerCase())) {

            skippedCount++;
            continue;
          }
          
          try {
            const requestData = {
              keyword: keyword.keyword,
              campaign_id: campaignId,
              trend_score: keyword.trend,
              mentions_count: keyword.competition,
              date_created: new Date().toISOString(),
              last_checked: new Date().toISOString()
            };



            
            await apiClient.keywords.create(requestData);

            addedCount++;
          } catch (err: any) {
            
            // Если ошибка связана с дубликатом, просто пропускаем это ключевое слово
            const errorMessage = err.response?.data?.errors?.[0]?.message || '';
            if (errorMessage.includes('Дубликат ключевого слова') || 
                errorMessage.includes('duplicate') || 
                errorMessage.includes('unique')) {

            }
            skippedCount++;
          }
        }

        // Формируем информативное сообщение о результате
        let description = "";
        if (addedCount > 0) {
          description = t('analytics.websiteAnalyzer.keywordsAdded', { count: addedCount });
          if (skippedCount > 0) {
            description += `, ${t('analytics.websiteAnalyzer.duplicatesSkipped', { count: skippedCount })}`;
          }
        } else if (skippedCount > 0) {
          description = t('analytics.websiteAnalyzer.allDuplicates', { count: skippedCount });
        }

        toast({
          title: addedCount > 0 ? t('analytics.websiteAnalyzer.savedSuccessfully') : t('analytics.websiteAnalyzer.information'),
          description,
        });
        
        // Сбрасываем выбранные ключевые слова
        setSelectedKeywords(new Set());
      }
    } catch (error) {
      console.error("Keywords save error:", error);
      
      // Проверяем, есть ли в ошибке информация о дубликатах
      const errorMessage = (error as any).response?.data?.message || (error as any).message || "";
      if (errorMessage.toLowerCase().includes("дубликат") || 
          errorMessage.toLowerCase().includes("duplicate") || 
          errorMessage.toLowerCase().includes("already exists")) {
        toast({
          title: t('analytics.websiteAnalyzer.duplicateKeywords'),
          description: t('analytics.websiteAnalyzer.duplicateKeywordsDesc'),
        });
      } else {
        toast({
          title: t('analytics.websiteAnalyzer.saveError'),
          description: t('analytics.websiteAnalyzer.saveErrorDesc'),
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('analytics.websiteAnalyzer.title')}</CardTitle>
        <CardDescription>
          {t('analytics.websiteAnalyzer.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('analytics.websiteAnalyzer.placeholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && urlStatus === "valid" && handleAnalyze()}
              className={`pl-9 ${urlStatus === "valid" ? "border-green-500" : urlStatus === "invalid" ? "border-red-500" : ""}`}
            />
            {urlStatus === "valid" && (
              <CheckCircle className="absolute right-3 top-3 h-4 w-4 text-green-500" />
            )}
            {urlStatus === "invalid" && (
              <XCircle className="absolute right-3 top-3 h-4 w-4 text-red-500" />
            )}
          </div>
          <Button 
            onClick={handleAnalyze} 
            disabled={isAnalyzing || urlStatus !== "valid"}
            className={urlStatus === "valid" ? "bg-green-500 hover:bg-green-600" : ""}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('analytics.websiteAnalyzer.analyzing')}
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                {t('analytics.websiteAnalyzer.findKeywords')}
              </>
            )}
          </Button>
        </div>
        {urlStatus === "invalid" && url.trim() !== "" && (
          <p className="text-red-500 text-sm mt-1">{t('analytics.websiteAnalyzer.urlInvalidText')}</p>
        )}
        {urlStatus === "valid" && (
          <p className="text-green-500 text-sm mt-1">{t('analytics.websiteAnalyzer.urlValidText')}</p>
        )}

        {keywords.length > 0 && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="select-all"
                  checked={selectedKeywords.size === keywords.length && keywords.length > 0}
                  onCheckedChange={toggleAll}
                />
                <label
                  htmlFor="select-all"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {t('analytics.websiteAnalyzer.selectAll')}
                </label>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveSelected}
                disabled={selectedKeywords.size === 0}
              >
                {t('analytics.websiteAnalyzer.saveSelected', { count: selectedKeywords.size })}
              </Button>
            </div>

            <div className="border rounded-md">
              <Table>
                <TableCaption>{t('analytics.websiteAnalyzer.tableCaption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>{t('analytics.websiteAnalyzer.keyword')}</TableHead>
                    <TableHead className="text-right">{t('analytics.websiteAnalyzer.popularity')}</TableHead>
                    <TableHead className="text-right">{t('analytics.websiteAnalyzer.competition')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywords.map((keyword, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Checkbox
                          checked={selectedKeywords.has(keyword.keyword)}
                          onCheckedChange={() => toggleKeyword(keyword.keyword)}
                        />
                      </TableCell>
                      <TableCell>{keyword.keyword}</TableCell>
                      <TableCell className="text-right">{keyword.trend.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{keyword.competition}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <div className="text-sm text-muted-foreground">
          {isAnalyzing ? (
            <span>{t('analytics.websiteAnalyzer.analyzingWebsite')}</span>
          ) : keywords.length > 0 ? (
            <span>{t('analytics.websiteAnalyzer.foundKeywords', { count: keywords.length })}</span>
          ) : (
            <span>{t('analytics.websiteAnalyzer.enterUrlPrompt')}</span>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}