import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation, useSearch } from "wouter";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";

/**
 * Подтверждение нового адреса почты по ссылке из письма.
 *
 * Страница намеренно НЕ подтверждает адрес сама при монтировании: почтовые
 * клиенты и антиспам-сканеры ходят по ссылкам из писем предзагрузкой, и
 * автоподтверждение срабатывало бы без участия человека, гася одноразовый
 * токен. Поэтому здесь есть явная кнопка.
 *
 * Разметка и состояния — по образцу pages/auth/reset-password.tsx.
 */
export default function ConfirmEmail() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const userId = params.get('userId') || '';
  const ts = params.get('ts') || '';
  const token = params.get('token') || '';
  // Новый адрес едет в ссылке и покрыт подписью — сервер его проверяет,
  // подменить в URL нельзя.
  const email = params.get('email') || '';

  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const isValidLink = !!(userId && ts && token && email);

  const onConfirm = async () => {
    setStatus('pending');
    try {
      const resp = await fetch('/api/auth/email-change/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ts, token, email }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErrorMsg(data.error || 'Не удалось подтвердить адрес');
        setStatus('error');
        return;
      }
      setNewEmail(data.email || '');
      setStatus('success');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ошибка сервера');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Подтверждение адреса</CardTitle>
          {status === 'idle' && isValidLink && (
            <CardDescription className="text-center">
              Подтвердите смену адреса вашего аккаунта SMM Manager
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!isValidLink ? (
            <div className="text-center space-y-4 py-4">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <p className="text-gray-700 font-medium">Неверная ссылка</p>
              <p className="text-sm text-gray-500">Ссылка подтверждения недействительна или повреждена.</p>
              <Button className="w-full" onClick={() => navigate("/auth/login")} data-testid="button-go-to-login">
                Войти
              </Button>
            </div>
          ) : status === 'success' ? (
            <div className="text-center space-y-4 py-4">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
              <p className="text-gray-700 font-medium">Адрес подтверждён!</p>
              <p className="text-sm text-gray-500">
                {newEmail
                  ? `Теперь вход в аккаунт выполняется по адресу ${newEmail}.`
                  : 'Теперь вход выполняется по новому адресу.'}
              </p>
              <Button className="w-full" onClick={() => navigate("/auth/login")} data-testid="button-go-to-login">
                Войти
              </Button>
            </div>
          ) : status === 'error' ? (
            <div className="text-center space-y-4 py-4">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <p className="text-gray-700 font-medium">Ошибка</p>
              <p className="text-sm text-gray-500">{errorMsg}</p>
              <p className="text-sm text-gray-500">
                Запросите смену адреса заново в профиле — старый адрес продолжает работать.
              </p>
              <Button variant="outline" className="w-full" onClick={() => navigate("/auth/login")} data-testid="button-try-again">
                Войти
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-4 py-4">
              <p className="text-gray-700 font-medium break-all">{email}</p>
              <p className="text-sm text-gray-500">
                Пока вы не подтвердите смену, вход и восстановление доступа работают по прежнему адресу.
              </p>
              <Button
                className="w-full"
                onClick={onConfirm}
                disabled={status === 'pending'}
                data-testid="button-confirm-email"
              >
                {status === 'pending' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Подтверждение...
                  </>
                ) : (
                  "Подтвердить новый адрес"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
