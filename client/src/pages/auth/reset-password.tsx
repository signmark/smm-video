import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";

const schema = z.object({
  password: z.string().min(6, "Минимум 6 символов"),
  confirm: z.string().min(6, "Минимум 6 символов"),
}).refine((d) => d.password === d.confirm, {
  message: "Пароли не совпадают",
  path: ["confirm"],
});

export default function ResetPassword() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const userId = params.get('userId') || '';
  const ts = params.get('ts') || '';
  const token = params.get('token') || '';

  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');

  const isValidLink = userId && ts && token;

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      const resp = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ts, token, password: values.password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErrorMsg(data.error || 'Не удалось сменить пароль');
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch (err: any) {
      toast({
        title: "Ошибка",
        description: err.message || "Ошибка сервера",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Новый пароль</CardTitle>
          {status === 'form' && isValidLink && (
            <CardDescription className="text-center">Введите новый пароль для вашего аккаунта</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!isValidLink ? (
            <div className="text-center space-y-4 py-4">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <p className="text-gray-700 font-medium">Неверная ссылка</p>
              <p className="text-sm text-gray-500">Ссылка для сброса пароля недействительна или повреждена.</p>
              <Button className="w-full" onClick={() => navigate("/auth/forgot-password")} data-testid="button-request-again">
                Запросить снова
              </Button>
            </div>
          ) : status === 'success' ? (
            <div className="text-center space-y-4 py-4">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
              <p className="text-gray-700 font-medium">Пароль успешно изменён!</p>
              <p className="text-sm text-gray-500">Теперь вы можете войти с новым паролем.</p>
              <Button className="w-full" onClick={() => navigate("/auth/login")} data-testid="button-go-to-login">
                Войти
              </Button>
            </div>
          ) : status === 'error' ? (
            <div className="text-center space-y-4 py-4">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <p className="text-gray-700 font-medium">Ошибка</p>
              <p className="text-sm text-gray-500">{errorMsg}</p>
              <Button variant="outline" className="w-full" onClick={() => navigate("/auth/forgot-password")} data-testid="button-try-again">
                Запросить новую ссылку
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Новый пароль</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Минимум 6 символов" data-testid="input-new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Повторите пароль</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Повторите пароль" data-testid="input-confirm-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                  data-testid="button-set-password"
                >
                  {form.formState.isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Сохранение...
                    </>
                  ) : (
                    "Сохранить пароль"
                  )}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
