import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Search } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { useAuthStore } from '@/lib/store';

// Определяем схему валидации для формы бизнес-анкеты
const businessQuestionnaireSchema = z.object({
  companyName: z.string().min(1, { message: 'Название компании обязательно' }),
  contactInfo: z.string().optional(),
  businessDescription: z.string().min(10, { message: 'Описание должно содержать минимум 10 символов' }),
  mainDirections: z.string().optional(),
  brandImage: z.string().optional(),
  productsServices: z.string().optional(),
  targetAudience: z.string().optional(),
  customerResults: z.string().optional(),
  companyFeatures: z.string().optional(),
  businessValues: z.string().optional(),
  productBeliefs: z.string().optional(),
  competitiveAdvantages: z.string().optional(),
  marketingExpectations: z.string().optional(),
});

type BusinessQuestionnaireFormValues = z.infer<typeof businessQuestionnaireSchema>;

interface BusinessQuestionnaireFormProps {
  campaignId: string;
  onQuestionnaireUpdated?: () => void;
}

export function BusinessQuestionnaireForm({
  campaignId,
  onQuestionnaireUpdated,
}: BusinessQuestionnaireFormProps) {
  const { toast } = useToast();
  const authToken = useAuthStore(state => state.token);
  const [isEditMode, setIsEditMode] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isWebsiteDialogOpen, setIsWebsiteDialogOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzedWebsite, setHasAnalyzedWebsite] = useState(false);

  // Создаем экземпляр формы
  const form = useForm<BusinessQuestionnaireFormValues>({
    resolver: zodResolver(businessQuestionnaireSchema),
    defaultValues: {
      companyName: '',
      contactInfo: '',
      businessDescription: '',
      mainDirections: '',
      brandImage: '',
      productsServices: '',
      targetAudience: '',
      customerResults: '',
      companyFeatures: '',
      businessValues: '',
      productBeliefs: '',
      competitiveAdvantages: '',
      marketingExpectations: '',
    },
  });

  // Запрос на получение данных анкеты
  const { data: questionnaireData, isLoading } = useQuery({
    queryKey: ['business-questionnaire', campaignId],
    queryFn: async () => {
      try {
        const response = await apiRequest(`/api/campaigns/${campaignId}/questionnaire`);
        return response.data;
      } catch (error) {
        console.error('Error fetching questionnaire:', error);
        return null;
      }
    },
    enabled: !!campaignId,
  });

  // Мутация для создания анкеты
  const createQuestionnaireMutation = useMutation({
    mutationFn: async (values: BusinessQuestionnaireFormValues) => {
      try {

        const response = await apiRequest(`/api/campaigns/${campaignId}/questionnaire`, {
          method: 'POST',
          data: {
            ...values,
            campaignId,
          },
        });

        return response;
      } catch (error) {
        console.error('Error in create mutation:', error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: 'Анкета создана',
        description: 'Анкета успешно сохранена',
      });
      setIsEditMode(false);
      setHasAnalyzedWebsite(false); // Сбрасываем флаг после сохранения
      if (onQuestionnaireUpdated) {
        onQuestionnaireUpdated();
      }
      
      // Обновляем данные в кэше React Query
      queryClient.invalidateQueries({ queryKey: ['business-questionnaire', campaignId] });
    },
    onError: (error: Error) => {
      console.error('Error creating questionnaire:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать анкету. Пожалуйста, попробуйте снова.',
        variant: 'destructive',
      });
    },
  });

  // Мутация для обновления анкеты
  const updateQuestionnaireMutation = useMutation({
    mutationFn: async (values: BusinessQuestionnaireFormValues) => {
      if (!questionnaireData?.id) {
        console.error('Attempted to update questionnaire without ID');
        return null;
      }
      
      const response = await apiRequest(`/api/campaigns/${campaignId}/questionnaire/${questionnaireData.id}`, {
        method: 'PATCH',
        data: { 
          ...values,
          id: questionnaireData.id,
          campaignId: campaignId
        },
      });
      

      return response;
    },
    onSuccess: (response) => {

      toast({
        title: 'Анкета обновлена',
        description: 'Анкета успешно обновлена',
      });
      setIsEditMode(false);
      setHasAnalyzedWebsite(false); // Сбрасываем флаг после сохранения
      if (onQuestionnaireUpdated) {
        onQuestionnaireUpdated();
      }
      
      // Обновляем данные в кэше React Query
      queryClient.invalidateQueries({ queryKey: ['business-questionnaire', campaignId] });
    },
    onError: (error: Error) => {
      console.error('Error updating questionnaire:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось обновить анкету. Пожалуйста, попробуйте снова.',
        variant: 'destructive',
      });
    },
  });

  // Подгружаем данные в форму при их получении (но только если не анализировали сайт)
  useEffect(() => {
    if (questionnaireData && !hasAnalyzedWebsite) {
      form.reset({
        companyName: questionnaireData.companyName || '',
        contactInfo: questionnaireData.contactInfo || '',
        businessDescription: questionnaireData.businessDescription || '',
        mainDirections: questionnaireData.mainDirections || '',
        brandImage: questionnaireData.brandImage || '',
        productsServices: questionnaireData.productsServices || '',
        targetAudience: questionnaireData.targetAudience || '',
        customerResults: questionnaireData.customerResults || '',
        companyFeatures: questionnaireData.companyFeatures || '',
        businessValues: questionnaireData.businessValues || '',
        productBeliefs: questionnaireData.productBeliefs || '',
        competitiveAdvantages: questionnaireData.competitiveAdvantages || '',
        marketingExpectations: questionnaireData.marketingExpectations || '',
      });
    }
  }, [questionnaireData, form, hasAnalyzedWebsite]);

  // Обработка отправки формы
  const onSubmit = async (values: BusinessQuestionnaireFormValues) => {

    
    if (questionnaireData?.id) {

      updateQuestionnaireMutation.mutate(values);
    } else {

      createQuestionnaireMutation.mutate(values);
    }
  };

  // Переключение режима редактирования
  const toggleEditMode = () => {
    if (isEditMode) {
      // Сбрасываем изменения, если выходим из режима редактирования
      if (questionnaireData) {
        form.reset({
          companyName: questionnaireData.companyName || '',
          contactInfo: questionnaireData.contactInfo || '',
          businessDescription: questionnaireData.businessDescription || '',
          mainDirections: questionnaireData.mainDirections || '',
          brandImage: questionnaireData.brandImage || '',
          productsServices: questionnaireData.productsServices || '',
          targetAudience: questionnaireData.targetAudience || '',
          customerResults: questionnaireData.customerResults || '',
          companyFeatures: questionnaireData.companyFeatures || '',
          businessValues: questionnaireData.businessValues || '',
          productBeliefs: questionnaireData.productBeliefs || '',
          competitiveAdvantages: questionnaireData.competitiveAdvantages || '',
          marketingExpectations: questionnaireData.marketingExpectations || '',
        });
      }
    }
    setIsEditMode(!isEditMode);
  };

  // Состояние для индикатора прогресса
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);

  const analyzeWebsite = async () => {
    if (!websiteUrl) return;
    
    setIsAnalyzing(true);
    setShowProgress(true);
    setProgress(10); // Начальный прогресс
    
    // Используем простое уведомление без dismiss
    toast({
      title: 'Анализ сайта',
      description: 'Извлечение данных с сайта и анализ контента...',
    });
    
    // Симулируем прогресс во время ожидания ответа API
    const progressInterval = setInterval(() => {
      setProgress((prevProgress) => {
        // Увеличиваем прогресс постепенно, но не превышаем 90%
        // Последние 10% будут добавлены при успешном получении данных
        const newProgress = prevProgress + Math.random() * 5;
        return newProgress < 90 ? newProgress : 90;
      });
    }, 1000);
    
    try {
      const response = await apiRequest('/api/website-analysis', {
        method: 'POST',
        data: {
          url: websiteUrl,
          campaignId,
        },
      });
      
      // Останавливаем симуляцию прогресса
      clearInterval(progressInterval);
      
      if (response && response.data) {
        // Завершаем прогресс
        setProgress(100);
        
        const { data } = response;
        
        // Сохраняем предыдущие значения, чтобы использовать их, если новые не заполнены
        const prevValues = {
          companyName: form.getValues('companyName'),
          businessDescription: form.getValues('businessDescription'),
          productsServices: form.getValues('productsServices'),
          targetAudience: form.getValues('targetAudience'),
          businessValues: form.getValues('businessValues'),
          mainDirections: form.getValues('mainDirections'),
          companyFeatures: form.getValues('companyFeatures'),
          competitiveAdvantages: form.getValues('competitiveAdvantages'),
          brandImage: form.getValues('brandImage'),
          contactInfo: form.getValues('contactInfo'),
          customerResults: form.getValues('customerResults'),
          productBeliefs: form.getValues('productBeliefs'),
          marketingExpectations: form.getValues('marketingExpectations'),
        };
        
        // Обновляем поля формы данными, полученными из анализа сайта
        // Сохраняем старые значения, если новые отсутствуют



        
        // Проверяем каждое поле отдельно
        const fieldMapping = {
          companyName: 'Название компании',
          contactInfo: 'Контактная информация',
          businessDescription: 'Описание бизнеса',
          mainDirections: 'Основные направления',
          brandImage: 'Имидж бренда',
          productsServices: 'Продукты и услуги',
          targetAudience: 'Целевая аудитория',
          customerResults: 'Результаты клиентов',
          companyFeatures: 'Особенности компании',
          businessValues: 'Ценности бизнеса',
          productBeliefs: 'Убеждения о продукте',
          competitiveAdvantages: 'Конкурентные преимущества',
          marketingExpectations: 'Ожидания от маркетинга'
        };
        
        Object.entries(fieldMapping).forEach(([field, label]) => {
          const value = data[field];
          const hasValue = value && String(value).trim();

        });
        
        // Заполняем все поля данными от API (полностью заменяем старые данные)
        form.setValue('companyName', data.companyName || '');
        form.setValue('contactInfo', data.contactInfo || '');
        form.setValue('businessDescription', data.businessDescription || '');
        form.setValue('mainDirections', data.mainDirections || '');
        form.setValue('brandImage', data.brandImage || '');
        form.setValue('productsServices', data.productsServices || '');
        form.setValue('targetAudience', data.targetAudience || '');
        form.setValue('customerResults', data.customerResults || '');
        form.setValue('companyFeatures', data.companyFeatures || '');
        form.setValue('businessValues', data.businessValues || '');
        form.setValue('productBeliefs', data.productBeliefs || '');
        form.setValue('competitiveAdvantages', data.competitiveAdvantages || '');
        form.setValue('marketingExpectations', data.marketingExpectations || '');
        
        // Принудительно обновляем форму для отображения новых значений
        form.trigger();
        
        toast({
          title: 'Анализ сайта завершен',
          description: 'Данные успешно получены и заполнены в анкету.',
        });
        
        // Получаем значения формы
        const formValues = form.getValues();

        
        // Устанавливаем флаг, что анализ сайта был выполнен
        setHasAnalyzedWebsite(true);
        
        // Всегда устанавливаем режим редактирования после анализа сайта
        setIsEditMode(true);
        
        // Предлагаем пользователю сохранить данные
        toast({
          title: 'Данные подготовлены',
          description: 'Пожалуйста, проверьте и нажмите кнопку "Сохранить" или "Обновить" в нижней части формы, чтобы сохранить изменения',
          duration: 7000,
        });
        
        // Скрываем индикатор прогресса через 1 секунду
        setTimeout(() => {
          setShowProgress(false);
        }, 1000);
      }
    } catch (error) {
      console.error('Error analyzing website:', error);
      
      // Останавливаем симуляцию прогресса
      clearInterval(progressInterval);
      setShowProgress(false);
      
      toast({
        title: 'Ошибка анализа',
        description: 'Не удалось проанализировать сайт. Пожалуйста, проверьте URL и попробуйте снова.',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const hasQuestionnaire = !!questionnaireData?.id;

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="flex justify-center p-6">
          <div>Загрузка данных...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <Dialog open={isWebsiteDialogOpen} onOpenChange={setIsWebsiteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Анализ сайта компании</DialogTitle>
            <DialogDescription>
              Введите URL сайта компании для автоматического заполнения анкеты на основе данных с сайта.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="website-url" className="text-sm font-medium">
                URL сайта компании
              </label>
              <Input
                id="website-url"
                placeholder="https://example.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsWebsiteDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button
              onClick={() => {
                analyzeWebsite();
                setIsWebsiteDialogOpen(false);
              }}
              disabled={!websiteUrl || isAnalyzing}
            >
              {isAnalyzing ? "Анализ..." : "Анализировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {showProgress && (
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium">Анализ сайта</span>
            <span className="text-sm">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
            <div 
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}
      
      <div className="w-full">
        <div className="flex justify-end mb-4">
          <div className="flex gap-2">
            {hasQuestionnaire && !isEditMode && (
              <Button 
                variant="default" 
                onClick={toggleEditMode}
              >
                Редактировать
              </Button>
            )}
            {isEditMode && (
              <>
                <Button 
                  variant="secondary" 
                  className="flex items-center gap-1"
                  onClick={() => setIsWebsiteDialogOpen(true)}
                >
                  <Search className="h-4 w-4" />
                  Анализ сайта
                </Button>
                <Button 
                  variant="outline" 
                  onClick={toggleEditMode}
                >
                  Отмена
                </Button>
              </>
            )}
          </div>
        </div>
        
        {!hasQuestionnaire && !isEditMode ? (
          <div className="flex flex-col items-center py-8">
            <p className="text-muted-foreground mb-4 text-center">
              Бизнес-анкета помогает ИИ создавать контент, максимально подходящий вашей компании. Вы можете заполнить анкету вручную или воспользоваться функцией «Анализ сайта» для автоматического заполнения на основе данных с вашего сайта.
            </p>
            <div className="flex gap-3">
              <Button onClick={() => setIsEditMode(true)}>
                Заполнить вручную
              </Button>
              <Button variant="secondary" className="flex items-center gap-1" onClick={() => { setIsEditMode(true); setIsWebsiteDialogOpen(true); }}>
                <Search className="h-4 w-4" />
                Анализ сайта
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form 
              onSubmit={form.handleSubmit(onSubmit)} 
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Название компании</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          readOnly={!isEditMode && hasQuestionnaire}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="contactInfo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Контактная информация</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          readOnly={!isEditMode && hasQuestionnaire}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="businessDescription"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex flex-row justify-between items-center">
                      <FormLabel>Описание бизнеса</FormLabel>
                    </div>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="mainDirections"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Основные направления деятельности</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="brandImage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Образ бренда</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="productsServices"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Продукты и услуги</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetAudience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Целевая аудитория</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customerResults"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Какие результаты получают клиенты</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="companyFeatures"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Особенности компании</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="businessValues"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ценности бизнеса</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="productBeliefs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Убеждения о продукте/услуге</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="competitiveAdvantages"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Конкурентные преимущества</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        readOnly={!isEditMode && hasQuestionnaire}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            <FormField
              control={form.control}
              name="marketingExpectations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ожидания от маркетинга</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      readOnly={!isEditMode && hasQuestionnaire}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isEditMode && (
                <div className="flex justify-end space-x-2">
                  <Button 
                    type="submit"
                    variant="default"
                    size="lg"
                    className="animate-pulse"
                    disabled={createQuestionnaireMutation.isPending || updateQuestionnaireMutation.isPending}
                  >
                    {createQuestionnaireMutation.isPending || updateQuestionnaireMutation.isPending ? (
                      <>
                        <span className="mr-2">
                          {hasQuestionnaire ? "Обновление..." : "Сохранение..."}
                        </span>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </>
                    ) : (
                      <span>{hasQuestionnaire ? "Обновить" : "Сохранить"}</span>
                    )}
                  </Button>
                </div>
              )}
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}