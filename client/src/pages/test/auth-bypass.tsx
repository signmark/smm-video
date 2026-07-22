import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/store";

/**
 * DEV-ONLY auth bypass used by Playwright and manual UI smoke tests.
 *
 * The page mutates the real `auth_token` / `user_id` localStorage entries
 * with a fake token, which would let an attacker hijack a production
 * session by simply visiting the route. We hard-guard with both the
 * Vite env flag (so the lazy chunk is not even loaded in production)
 * AND a runtime check that no-ops the mutation and redirects home if
 * somehow the page is mounted in a production build (hot-patch, custom
 * devtools, etc.).
 */
const IS_DEV_BUILD = import.meta.env.DEV;

export default function AuthBypass() {
  const [, navigate] = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    if (!IS_DEV_BUILD) {
      // Defense in depth: never touch localStorage in a production build.
      // The router also points this route at <NotFound /> in prod, but
      // if a future change re-enables the route by accident this branch
      // still protects the user's session.
      console.warn('[auth-bypass] disabled in production');
      navigate('/');
      return;
    }

    // Устанавливаем временный токен для тестирования
    const tempToken = "test_token_" + Date.now();
    const tempUserId = "test_user_" + Date.now();

    // Записываем в localStorage
    localStorage.setItem('auth_token', tempToken);
    localStorage.setItem('user_id', tempUserId);

    // Устанавливаем в store
    setAuth(tempToken, tempUserId);

    console.log("Установлен временный токен для тестирования");

    // Перенаправляем на страницу тестирования прозрачных диалогов
    navigate("/test/transparent-dialog");
  }, [navigate, setAuth]);

  if (!IS_DEV_BUILD) {
    return null;
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Обход авторизации</h1>
        <p>Перенаправление на тестовую страницу...</p>
      </div>
    </div>
  );
}