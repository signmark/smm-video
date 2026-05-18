import { useEffect, useState } from "react";
import { AIChat } from "@/components/AIChat";
import { useTelegramWebApp } from "@/hooks/useTelegramWebApp";
import { useAuthStore } from "@/lib/store";
import { useCampaignStore } from "@/lib/campaignStore";

export default function AIAssistantPage() {
  const { webApp } = useTelegramWebApp();
  const [isOpen, setIsOpen] = useState(true);
  const { isAuthenticated } = useAuthStore();
  const { setSelectedCampaign } = useCampaignStore();

  useEffect(() => {
    // Настройка Telegram WebApp (обычный размер для AI Ассистента)
    if (webApp) {
      // НЕ используем expand() - оставляем обычный размер
      webApp.setHeaderColor('#1e40af');
      webApp.setBackgroundColor('#f8fafc');
      
      // Настройка кнопки "Назад"
      webApp.BackButton.show();
      webApp.BackButton.onClick(() => {
        webApp.close();
      });
    }

    return () => {
      if (webApp) {
        webApp.BackButton.hide();
      }
    };
  }, [webApp]);

  // Обработка campaign_id из URL параметров
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const campaignId = urlParams.get('campaign_id');
    
    if (campaignId) {
      console.log('[AI Assistant] Setting campaign from URL:', campaignId);
      setSelectedCampaign(campaignId);
    }
  }, [setSelectedCampaign]);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-500 dark:from-blue-900 dark:via-purple-900 dark:to-pink-900">
        <div className="text-center text-white p-6">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">Требуется авторизация</h1>
          <p className="text-blue-100">Пожалуйста, войдите в систему</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-500 dark:from-blue-900 dark:via-purple-900 dark:to-pink-900">
      <AIChat 
        isOpen={isOpen} 
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open && webApp) {
            webApp.close();
          }
        }}
        showFloatingButton={false}
        hideHeader={true}
        fullScreen={true}
      />
    </div>
  );
}
