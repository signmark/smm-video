import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageGenerationTester } from "@/components/ImageGenerationTester";
import { DeepSeekTester } from "@/components/DeepSeekTester";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/store";
import { useLocation } from "wouter";

/**
 * Страница для тестирования различных API
 */
export default function TestPage() {
  const [activeTab, setActiveTab] = useState("deepseek");
  const { toast } = useToast();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [, setLocation] = useLocation();

  // Проверяем авторизацию пользователя
  useEffect(() => {
    if (!isAuthenticated) {
      toast({
        variant: "destructive",
        title: "Требуется авторизация",
        description: "Для доступа к этой странице необходимо авторизоваться",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, setLocation, toast]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="container py-8">
      <div className="max-w-4xl mx-auto">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">Тестирование API</CardTitle>
            <CardDescription>
              Используйте эту страницу для проверки настроек и работоспособности API сервисов
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              Для корректной работы убедитесь, что вы добавили API ключи в настройках профиля.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setLocation("/settings")}>
                Перейти к настройкам API ключей
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/test/imgur")}>
                Тестировать Imgur интеграцию
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/test/html-tags")}>
                Тестировать исправление HTML-тегов
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-2 w-full mb-6">
            <TabsTrigger value="deepseek">DeepSeek API</TabsTrigger>
            <TabsTrigger value="falai">FAL.AI (генерация изображений)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="deepseek">
            <DeepSeekTester />
          </TabsContent>
          
          <TabsContent value="falai">
            <ImageGenerationTester />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}