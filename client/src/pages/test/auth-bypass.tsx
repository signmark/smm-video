import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/store";

/**
 * Страница для обхода авторизации при тестировании компонентов
 * Устанавливает временный токен и перенаправляет на запрошенную страницу
 */
export default function AuthBypass() {
  const [, navigate] = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  useEffect(() => {
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
  
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Обход авторизации</h1>
        <p>Перенаправление на тестовую страницу...</p>
      </div>
    </div>
  );
}