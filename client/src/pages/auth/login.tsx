import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/store";
import { useLocation } from "wouter";
import { Loader2, UserPlus } from "lucide-react";
import { directusApi } from "@/lib/directus";
import { setupTokenRefresh } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Неверный формат email"),
  password: z.string().min(1, "Пароль обязателен"),
});

export default function Login() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {


      // Используем наш API для аутентификации
      const { getFullApiUrl } = await import('@/lib/api-config');
      const apiUrl = getFullApiUrl('LOGIN');
      

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: values.email,
          password: values.password
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Login response error:', errorText);
        throw new Error("Ошибка при входе: " + response.statusText);
      }

      const authData = await response.json();
      
      if (!authData?.token || !authData?.refresh_token || !authData?.user?.id) {
        throw new Error("Неверный формат ответа от сервера");
      }

      const access_token = authData.token;
      const refresh_token = authData.refresh_token;
      const expires = authData.expires || 86400; // API возвращает секунды
      const userId = authData.user?.id;
      


      
      // Сохраняем в localStorage и в state
      localStorage.setItem('auth_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
      localStorage.setItem('user_id', userId);
      
      // Также обновляем состояние авторизации
      setAuth(access_token, userId);

      // Устанавливаем автоматическое обновление токена
      setupTokenRefresh(expires * 1000);
      
      // Добавляем задержку в 100мс, чтобы дать другим компонентам времени обновиться
      await new Promise(resolve => setTimeout(resolve, 100));

      // Редирект на главную
      navigate("/campaigns");

      toast({
        title: "Успешный вход",
        description: "Добро пожаловать в SMM Manager",
      });

    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: "Ошибка входа",
        description: error instanceof Error ? error.message : "Проверьте email и пароль",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Вход в SMM Manager</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Введите email" type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Пароль</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Введите пароль" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full" 
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Вход...
                  </>
                ) : (
                  "Войти"
                )}
              </Button>
            </form>
          </Form>
          
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 mb-3">
              Нет аккаунта?
            </p>
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => navigate("/auth/register")}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Создать аккаунт
            </Button>
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={() => navigate("/auth/forgot-password")}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
              data-testid="link-forgot-password"
            >
              Забыли пароль?
            </button>
          </div>

          <div className="mt-2 text-center">
            <button
              onClick={() => navigate("/pricing")}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 hover:underline"
              data-testid="link-pricing-from-login"
            >
              Посмотреть тарифы
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
