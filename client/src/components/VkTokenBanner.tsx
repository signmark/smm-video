import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X, RefreshCw, Loader2 } from "lucide-react";
import { useCampaignStore } from "@/lib/campaignStore";
import { useAuthStore } from "@/lib/store";
import { queryClient } from "@/lib/queryClient";
import {
  getVkTokenWebhookStatus,
  prepareVkTokenWebhook,
} from "@/lib/vk-token-webhook";

const DISMISSED_KEY = "vk_token_banner_dismissed_";

async function fetchVkSettings(campaignId: string): Promise<Record<string, any> | null> {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.settings || null;
}

export function VkTokenBanner() {
  const { selectedCampaignId } = useCampaignStore();
  const userId = useAuthStore((state) => state.userId);
  const [dismissed, setDismissed] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const checkClosedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dismissedKey = DISMISSED_KEY + (selectedCampaignId || "");

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissedKey) === "1");
  }, [selectedCampaignId, dismissedKey]);

  useEffect(() => {
    return () => {
      if (listenerRef.current) window.removeEventListener("message", listenerRef.current);
      if (checkClosedRef.current) clearInterval(checkClosedRef.current);
    };
  }, []);

  const { data: vkSettings } = useQuery({
    queryKey: ["/api/vk-settings-for-banner", selectedCampaignId],
    queryFn: () => fetchVkSettings(selectedCampaignId!),
    enabled: !!selectedCampaignId && !!userId && !dismissed,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  const handleDismiss = () => {
    localStorage.setItem(dismissedKey, "1");
    setDismissed(true);
  };

  const cleanup = () => {
    if (listenerRef.current) {
      window.removeEventListener("message", listenerRef.current);
      listenerRef.current = null;
    }
    if (checkClosedRef.current) {
      clearInterval(checkClosedRef.current);
      checkClosedRef.current = null;
    }
    setIsReconnecting(false);
  };

  const startReconnect = async () => {
    if (!selectedCampaignId) return;

    // token объявлен локально: в scope компонента его нет (единственный const token
    // живёт внутри fetchVkSettings), а без него ссылки ниже падали ReferenceError.
    const token = localStorage.getItem("auth_token");

    // Стабильный webhook URL (постоянный секрет): уже сохранённый в needanapp URL
    // продолжит работать. Кладём URL в буфер обмена на случай первой настройки.
    try {
      const webhookUrl = await prepareVkTokenWebhook(selectedCampaignId);
      if (webhookUrl) {
        try {
          await navigator.clipboard.writeText(webhookUrl);
          setUrlCopied(true);
        } catch {}
      }
    } catch {}

    // Открываем needanapp в новой вкладке
    window.open('https://vk.needanapp.ru', '_blank');
    setIsReconnecting(true);

    // Запускаем polling webhook status
    checkClosedRef.current = setInterval(async () => {
      try {
        const status = await getVkTokenWebhookStatus(selectedCampaignId);
        if (status?.ready) {
          cleanup();
          setDismissed(false);
          localStorage.removeItem(dismissedKey);
          queryClient.invalidateQueries({ queryKey: ["/api/vk-settings-for-banner", selectedCampaignId] });
        }
      } catch {}
    }, 3000);

    // Таймаут 5 минут
    setTimeout(() => {
      if (checkClosedRef.current) {
        cleanup();
      }
    }, 5 * 60 * 1000);
  };

  if (!selectedCampaignId || dismissed || !vkSettings) return null;

  const tokenExpiredByDate = vkSettings.tokenExpiresAt
    ? new Date(vkSettings.tokenExpiresAt).getTime() < Date.now()
    : false;
  const shouldShow =
    vkSettings.authExpired === true ||
    (!vkSettings.refreshToken && tokenExpiredByDate);

  if (!shouldShow) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5">
      <div className="flex items-center gap-3 max-w-full">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-200 flex-1 min-w-0">
          <span className="font-medium">Токен ВКонтакте истёк.</span>
          {" "}Публикации в VK не будут работать.{" "}
          <button
            onClick={startReconnect}
            disabled={isReconnecting}
            className="inline-flex items-center gap-1 underline font-medium hover:no-underline disabled:opacity-50"
            data-testid="button-vk-reconnect-banner"
          >
            {isReconnecting
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Подключение...</>
              : <><RefreshCw className="h-3 w-3" /> Переподключить VK</>
            }
          </button>
          {isReconnecting && urlCopied && (
            <span className="ml-2 text-xs">Webhook URL скопирован — вставьте его в needanapp, если ещё не сохранён.</span>
          )}
        </p>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
          aria-label="Закрыть"
          data-testid="button-dismiss-vk-banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
