import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type FormatTestResult = {
  format: string;
  success: boolean;
  result?: string;
  error?: string;
};

type TestResponse = {
  success: boolean;
  results: FormatTestResult[];
  message?: string;
  recommendation?: {
    message: string;
    apiKey: string;
  };
};

/**
 * Компонент для тестирования DeepSeek API
 */
export function DeepSeekTester() {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("Напиши небольшой текст на тему здорового питания для публикации в социальных сетях");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [testingApiKey, setTestingApiKey] = useState(false);
  const [testResults, setTestResults] = useState<FormatTestResult[]>([]);
  const [recommendation, setRecommendation] = useState<{message: string, apiKey: string} | null>(null);
  const [activeTab, setActiveTab] = useState("setup");
  const { toast } = useToast();

  // Функция для сохранения ключа API
  async function saveApiKey(keyToSave?: string) {
    const keyValue = keyToSave || apiKey;
    
    if (!keyValue) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Введите ключ API DeepSeek",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest("/api/save-deepseek-key", {
        method: "POST",
        data: { apiKey: keyValue },
      });

      if (response.success) {
        toast({
          title: "Успешно",
          description: "Ключ API DeepSeek сохранен",
        });
        
        // Если сохраняли рекомендуемый ключ, сбрасываем рекомендацию
        if (keyToSave) {
          setRecommendation(null);
        }
        
        // Переключаемся на вкладку тестирования
        setActiveTab("test");
      } else {
        toast({
          variant: "destructive",
          title: "Ошибка",
          description: response.message || "Не удалось сохранить ключ API",
        });
      }
    } catch (err) {
      console.error("Ошибка при сохранении ключа API:", err);
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Не удалось сохранить ключ API DeepSeek",
      });
    } finally {
      setLoading(false);
    }
  }

  // Функция для тестирования различных форматов API ключа
  async function testApiKeyFormats() {
    if (!apiKey && !testResults.some(r => r.success)) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Введите ключ API DeepSeek для тестирования",
      });
      return;
    }

    setTestingApiKey(true);
    setTestResults([]);
    setRecommendation(null);
    
    try {
      const response = await apiRequest<TestResponse>("/api/test-deepseek", {
        method: "GET",
        params: apiKey ? { apiKey } : undefined,
      });

      if (response.success) {
        setTestResults(response.results);
        
        // Если есть рекомендация по формату ключа
        if (response.recommendation) {
          setRecommendation(response.recommendation);
        }
        
        toast({
          title: "Успешно",
          description: response.message || "Тестирование форматов ключа завершено",
        });
      } else {
        toast({
          variant: "destructive", 
          title: "Ошибка",
          description: response.message || "Не удалось протестировать форматы ключа API",
        });
      }
    } catch (err) {
      console.error("Ошибка при тестировании форматов ключа API:", err);
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Произошла ошибка при тестировании форматов ключа API",
      });
    } finally {
      setTestingApiKey(false);
    }
  }

  // Функция для тестирования генерации текста
  async function testDeepSeekApi() {
    if (!prompt) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Введите запрос для тестирования",
      });
      return;
    }

    setLoading(true);
    setError("");
    setResult("");
    
    try {
      const response = await apiRequest("/api/test-deepseek-generate", {
        method: "POST",
        data: { prompt },
      });

      if (response.success) {
        setResult(response.data);
        toast({
          title: "Успешно",
          description: "Запрос к DeepSeek API выполнен успешно",
        });
      } else {
        setError(response.error || "Не удалось получить ответ от API");
        toast({
          variant: "destructive",
          title: "Ошибка",
          description: response.error || "Не удалось получить ответ от API",
        });
      }
    } catch (err: any) {
      console.error("Ошибка при тестировании API:", err);
      setError(err.message || "Произошла ошибка при выполнении запроса к API DeepSeek");
    } finally {
      setLoading(false);
    }
  }
  
  // Функция для тестирования генерации промта для изображения
  const [imagePromptContent, setImagePromptContent] = useState<string>("Здоровое питание является основой хорошего самочувствия и профилактики многих заболеваний. Сбалансированный рацион должен включать достаточное количество белков, жиров, углеводов, витаминов и минералов.");
  const [imagePromptKeywords, setImagePromptKeywords] = useState<string>("здоровье, питание, фрукты, овощи");
  const [imagePromptResult, setImagePromptResult] = useState<string>("");
  const [imagePromptError, setImagePromptError] = useState<string>("");
  const [imagePromptLoading, setImagePromptLoading] = useState<boolean>(false);
  
  async function testImagePromptGeneration() {
    if (!imagePromptContent) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Введите контент для генерации промта",
      });
      return;
    }

    setImagePromptLoading(true);
    setImagePromptError("");
    setImagePromptResult("");
    
    try {
      // Преобразуем строку ключевых слов в массив
      const keywords = imagePromptKeywords
        .split(',')
        .map(kw => kw.trim())
        .filter(kw => kw.length > 0);
      
      const response = await apiRequest("/api/test-deepseek-image-prompt", {
        method: "POST",
        data: { 
          content: imagePromptContent,
          keywords
        },
      });

      if (response.success) {
        setImagePromptResult(response.data);
        toast({
          title: "Успешно",
          description: "Промт для изображения успешно сгенерирован",
        });
      } else {
        setImagePromptError(response.error || "Не удалось сгенерировать промт для изображения");
        toast({
          variant: "destructive",
          title: "Ошибка",
          description: response.error || "Не удалось сгенерировать промт для изображения",
        });
      }
    } catch (err: any) {
      console.error("Ошибка при генерации промта для изображения:", err);
      setImagePromptError(err.message || "Произошла ошибка при генерации промта для изображения");
    } finally {
      setImagePromptLoading(false);
    }
  }

  // Рендерим результаты тестирования форматов ключей
  function renderKeyFormatResults() {
    if (testResults.length === 0) {
      return null;
    }

    return (
      <div className="space-y-3 mt-4">
        <h3 className="text-sm font-medium">Результаты тестирования форматов ключа:</h3>
        <div className="space-y-2">
          {testResults.map((result, index) => (
            <div key={index} className="flex items-start space-x-2 p-2 rounded border">
              {result.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-sm">
                <div className="font-medium">
                  Формат: {result.format}
                  <Badge className="ml-2" variant={result.success ? "default" : "destructive"}>
                    {result.success ? "Работает" : "Не работает"}
                  </Badge>
                </div>
                {result.success && result.result && (
                  <div className="mt-1 text-xs">
                    <span className="text-muted-foreground">Ответ API:</span>{" "}
                    <span className="font-medium">{result.result}</span>
                  </div>
                )}
                {!result.success && result.error && (
                  <div className="mt-1 text-xs text-red-500">{result.error}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {recommendation && (
          <Alert className="mt-4 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">Рекомендация</AlertTitle>
            <AlertDescription className="text-green-700">
              <p>{recommendation.message}</p>
              <Button 
                size="sm"
                variant="outline"
                className="mt-2 border-green-300 text-green-700 hover:bg-green-100"
                onClick={() => saveApiKey(recommendation.apiKey)}
                disabled={loading}
              >
                <Save className="mr-2 h-4 w-4" />
                Сохранить рекомендуемый формат
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-2">
          <TabsTrigger value="setup">Настройка ключа</TabsTrigger>
          <TabsTrigger value="test">Генерация текста</TabsTrigger>
          <TabsTrigger value="image-prompt">Генерация промта для изображения</TabsTrigger>
        </TabsList>
        
        <TabsContent value="setup">
          <Card>
            <CardHeader>
              <CardTitle>Настройка DeepSeek API</CardTitle>
              <CardDescription>
                Введите ключ API DeepSeek и проверьте его работоспособность с разными форматами
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Input
                    placeholder="Введите ключ API DeepSeek"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type="password"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ключ API будет безопасно сохранен в базе данных. Система автоматически попробует разные форматы ключа.
                  </p>
                </div>
                
                {renderKeyFormatResults()}
              </div>
            </CardContent>
            <CardFooter className="flex space-x-2">
              <Button onClick={() => saveApiKey()} disabled={loading || testingApiKey || !apiKey}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Сохранить ключ API
              </Button>
              <Button 
                variant="outline" 
                onClick={testApiKeyFormats} 
                disabled={loading || testingApiKey || (!apiKey && testResults.length === 0)}
              >
                {testingApiKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Проверить форматы ключа
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        
        <TabsContent value="test">
          <Card>
            <CardHeader>
              <CardTitle>Генерация текста с DeepSeek</CardTitle>
              <CardDescription>
                Протестируйте возможности DeepSeek API для генерации текста
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium" htmlFor="prompt">
                    Запрос:
                  </label>
                  <Textarea
                    id="prompt"
                    placeholder="Введите запрос для DeepSeek API"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    className="mt-1"
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Ошибка</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {result && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Результат:</div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(result);
                          toast({
                            title: "Скопировано",
                            description: "Текст скопирован в буфер обмена",
                            duration: 2000,
                          });
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="mr-1.5 h-4 w-4"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        Копировать
                      </Button>
                    </div>
                    <div className="rounded-md border p-4 whitespace-pre-wrap text-sm">{result}</div>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={testDeepSeekApi} disabled={loading || !prompt}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сгенерировать текст
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        
        <TabsContent value="image-prompt">
          <Card>
            <CardHeader>
              <CardTitle>Генерация промта для изображения</CardTitle>
              <CardDescription>
                Используйте DeepSeek для генерации качественных промтов для AI-изображений
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium" htmlFor="imagePromptContent">
                    Контент для генерации промта:
                  </label>
                  <Textarea
                    id="imagePromptContent"
                    placeholder="Введите текст, на основе которого нужно сгенерировать промт для изображения"
                    value={imagePromptContent}
                    onChange={(e) => setImagePromptContent(e.target.value)}
                    rows={4}
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium" htmlFor="imagePromptKeywords">
                    Ключевые слова (через запятую):
                  </label>
                  <Input
                    id="imagePromptKeywords"
                    placeholder="Введите ключевые слова для усиления промта"
                    value={imagePromptKeywords}
                    onChange={(e) => setImagePromptKeywords(e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Ключевые слова помогут сфокусировать промт на нужной тематике
                  </p>
                </div>

                {imagePromptError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Ошибка</AlertTitle>
                    <AlertDescription>{imagePromptError}</AlertDescription>
                  </Alert>
                )}

                {imagePromptResult && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Сгенерированный промт:</div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(imagePromptResult);
                          toast({
                            title: "Скопировано",
                            description: "Промт скопирован в буфер обмена",
                            duration: 2000,
                          });
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="mr-1.5 h-4 w-4"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        Копировать
                      </Button>
                    </div>
                    <div className="rounded-md border p-4 whitespace-pre-wrap text-sm bg-slate-50">
                      {imagePromptResult}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Этот промт можно использовать в сервисах генерации изображений
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                onClick={testImagePromptGeneration} 
                disabled={imagePromptLoading || !imagePromptContent}
              >
                {imagePromptLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сгенерировать промт для изображения
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}