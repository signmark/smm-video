import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/lib/store";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { CampaignCreationProgress, CampaignCreationStep } from "./CampaignCreationProgress";

interface CampaignFormProps {
  onClose: () => void;
}

const campaignFormSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
  autoAnalyzeWebsite: z.boolean().default(false),
  autoFillQuestionnaire: z.boolean().default(false),
  autoGenerateKeywords: z.boolean().default(false)
});

type CampaignFormValues = z.infer<typeof campaignFormSchema>;

export function CampaignForm({ onClose }: CampaignFormProps) {
  const { toast } = useToast();
  const { userId } = useAuthStore();
  const [, setLocation] = useLocation();
  const [creationSteps, setCreationSteps] = useState<CampaignCreationStep[]>([]);
  const [showProgress, setShowProgress] = useState(false);

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      name: "",
      description: "",
      websiteUrl: "",
      autoAnalyzeWebsite: false,
      autoFillQuestionnaire: false,
      autoGenerateKeywords: false
    },
  });

  const { getAuthToken } = useAuthStore();
  
  const updateStepStatus = (stepId: string, status: CampaignCreationStep["status"], errorMessage?: string) => {
    setCreationSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { ...step, status, errorMessage }
        : step
    ));
  };

  // Функция подготовки и отправки формы
  const onSubmit = (values: CampaignFormValues) => {
    console.log('onSubmit called with:', values);
    // Создаем массив шагов на основе АКТУАЛЬНЫХ значений формы
    const steps: CampaignCreationStep[] = [
      {
        id: "create",
        label: "Создание кампании",
        status: "pending"
      }
    ];
    
    if (values.websiteUrl && values.autoAnalyzeWebsite) {
      steps.push({
        id: "analyze",
        label: "Анализ сайта",
        status: "pending"
      });
      
      if (values.autoFillQuestionnaire) {
        steps.push({
          id: "questionnaire",
          label: "Заполнение бизнес-анкеты",
          status: "pending"
        });
      }
    }
    
    if (values.websiteUrl && values.autoGenerateKeywords) {
      steps.push({
        id: "keywords",
        label: "Подбор ключевых слов",
        status: "pending"
      });
    }
    
    // Устанавливаем шаги и показываем прогресс ДО начала мутации
    setCreationSteps(steps);
    setShowProgress(true);
    
    // Запускаем мутацию
    createCampaign(values);
  };

  const { mutate: createCampaign, isPending } = useMutation({
    mutationFn: async (values: CampaignFormValues) => {
      if (!userId) {
        throw new Error("Необходима авторизация");
      }
      
      const token = getAuthToken();
      if (!token) {
        throw new Error("Отсутствует токен авторизации");
      }

      // Небольшая задержка чтобы UI успел отрендериться
      await new Promise(resolve => setTimeout(resolve, 100));
      updateStepStatus("create", "in-progress");

      let campaignId: string;
      
      try {
        // ШАГ 1: Создаем кампанию БЕЗ автоматизации
        const response = await fetch('/api/campaigns', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            name: values.name.trim(),
            description: values.description?.trim() || null,
            link: values.websiteUrl?.trim() || null,
            userId: userId,
          })
        });

        if (!response.ok) {
          const error = await response.json();
          if (error.error === 'limit_exceeded') {
            updateStepStatus("create", "error", error.message);
            throw new Error(error.message);
          }
          updateStepStatus("create", "error", error.error || "Не удалось создать кампанию");
          throw new Error(error.error || "Не удалось создать кампанию");
        }

        const result = await response.json();
        campaignId = result.data.id;
        console.log('✅ Кампания создана, ID:', campaignId);
        updateStepStatus("create", "completed");
        
      } catch (networkError: any) {
        updateStepStatus("create", "error", "Ошибка сети: " + (networkError.message || "Проверьте подключение к интернету"));
        throw networkError;
      }
      
      // ШАГ 2: Анализ сайта (если включен)
      let analysisData: any = null;
      if (values.websiteUrl && values.autoAnalyzeWebsite) {
        try {
          console.log('Starting analysis with campaignId:', campaignId);
          console.log('Analysis URL:', values.websiteUrl);
          
          if (!campaignId) {
            throw new Error("Internal Error: Campaign ID is missing after creation");
          }

          updateStepStatus("analyze", "in-progress");
          
          const analysisBody = { url: values.websiteUrl, campaignId };
          console.log('Analysis Request Body:', JSON.stringify(analysisBody));

          const analysisResponse = await fetch('/api/analyze-site', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(analysisBody)
          });
          
          if (!analysisResponse.ok) {
            const errorText = await analysisResponse.text();
            console.log('Analysis Error Response:', errorText);
            throw new Error(`Ошибка анализа сайта: ${errorText || analysisResponse.statusText}`);
          }
          
          analysisData = await analysisResponse.json();
          updateStepStatus("analyze", "completed");
        } catch (error: any) {
          updateStepStatus("analyze", "error", error.message);
        }
      }
      
      // ШАГ 3: Заполнение анкеты (если включено)
      // Анкета уже сохранена на шаге 2 (analyze-site), просто помечаем шаг как завершённый
      if (values.autoFillQuestionnaire) {
        if (analysisData) {
          updateStepStatus("questionnaire", "completed");
        } else {
          updateStepStatus("questionnaire", "error", "Не удалось заполнить анкету: анализ сайта не завершён");
        }
      }
      
      // ШАГ 4: Подбор ключевых слов (если включен)
      if (values.websiteUrl && values.autoGenerateKeywords) {
        try {
          updateStepStatus("keywords", "in-progress");
          
          const keywordsResponse = await fetch(`/api/campaigns/${campaignId}/keywords`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ url: values.websiteUrl, campaignId })
          });
          
          if (!keywordsResponse.ok) {
            const errorText = await keywordsResponse.text();
            throw new Error(`Ошибка подбора ключевых слов: ${errorText || keywordsResponse.statusText}`);
          }
          
          updateStepStatus("keywords", "completed");
        } catch (error: any) {
          updateStepStatus("keywords", "error", error.message);
        }
      }

      console.log('✅ Все шаги завершены, возвращаем campaignId:', campaignId);
      return { data: { id: campaignId } };
    },
    onSuccess: (newCampaign) => {
      // Immediately update the cache to show the new campaign
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", userId] });
      
      // Show success message
      toast({
        description: "Кампания создана"
      });

      // Navigate to campaign detail page after a short delay, then close dialog
      const campaignId = newCampaign?.data?.id;
      setTimeout(() => {
        setShowProgress(false);
        onClose();
        if (campaignId) {
          setLocation(`/campaigns/${campaignId}`);
        }
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        description: error.message
      });
      
      // Скрываем прогресс при ошибке
      setTimeout(() => {
        setShowProgress(false);
      }, 3000);
    }
  });

  return (
    <>
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h2 className="text-lg font-semibold leading-none tracking-tight">Создать новую кампанию</h2>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Название</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="Введите название кампании" 
                    {...field} 
                    disabled={isPending}
                    data-testid="input-campaign-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Описание</FormLabel>
                <FormDescription>Описание компании помогает ИИ лучше понять ваш бизнес и генерировать более точный и релевантный контент для социальных сетей.</FormDescription>
                <FormControl>
                  <Textarea 
                    placeholder="Введите описание кампании" 
                    {...field} 
                    disabled={isPending}
                    data-testid="input-campaign-description"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="websiteUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Сайт компании (опционально)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="https://example.com" 
                    {...field} 
                    disabled={isPending}
                    data-testid="input-campaign-website"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <Separator className="my-4" />
          
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Автоматизация при создании</h3>
            
            <FormField
              control={form.control}
              name="autoAnalyzeWebsite"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('websiteUrl') || isPending}
                      data-testid="checkbox-auto-analyze"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm">
                      Автоматически проанализировать сайт
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Извлечь информацию о бизнесе с сайта
                    </p>
                  </div>
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="autoFillQuestionnaire"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('autoAnalyzeWebsite') || isPending}
                      data-testid="checkbox-auto-fill-questionnaire"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm">
                      Автоматически заполнить анкету
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Заполнить бизнес-анкету данными с сайта
                    </p>
                  </div>
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="autoGenerateKeywords"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('websiteUrl') || isPending}
                      data-testid="checkbox-auto-generate-keywords"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm">
                      Автоматически подобрать ключевые слова
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Анализ сайта и подбор ключевых слов
                    </p>
                  </div>
                </FormItem>
              )}
            />
          </div>
          
          {/* Progress Visualization */}
          {showProgress && creationSteps.length > 0 && (
            <>
              <Separator className="my-4" />
              <CampaignCreationProgress steps={creationSteps} />
            </>
          )}
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} type="button" disabled={isPending}>
              Отмена
            </Button>
            <Button type="submit" disabled={isPending} data-testid="button-create-campaign">
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Создание...
                </>
              ) : (
                "Создать"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}