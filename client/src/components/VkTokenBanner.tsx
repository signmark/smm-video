import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, X, Settings } from "lucide-react";
import { useCampaignStore } from "@/lib/campaignStore";
import { useAuthStore } from "@/lib/store";

const DISMISSED_KEY = "vk_token_banner_dismissed_";

async function fetchVkSettings(campaignId: string): Promise<{ token?: string; groupId?: string } | null> {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.settings || null;
}

async function validateVkToken(token: string, groupId?: string): Promise<boolean> {
  const authToken = localStorage.getItem("auth_token");
  const res = await fetch("/api/validate/vk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    },
    body: JSON.stringify({ token, groupId })
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

export function VkTokenBanner() {
  const { selectedCampaignId } = useCampaignStore();
  const userId = useAuthStore((state) => state.userId);
  const [dismissed, setDismissed] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);
  const [checked, setChecked] = useState(false);

  const dismissedKey = DISMISSED_KEY + (selectedCampaignId || "");

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissedKey) === "1");
    setIsInvalid(false);
    setChecked(false);
  }, [selectedCampaignId, dismissedKey]);

  const { data: vkSettings } = useQuery({
    queryKey: ["/api/vk-settings-for-banner", selectedCampaignId],
    queryFn: () => fetchVkSettings(selectedCampaignId!),
    enabled: !!selectedCampaignId && !!userId && !dismissed,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!vkSettings || checked || dismissed) return;
    if (!vkSettings.token) {
      setChecked(true);
      return;
    }

    let cancelled = false;
    validateVkToken(vkSettings.token, vkSettings.groupId).then((valid) => {
      if (!cancelled) {
        setIsInvalid(!valid);
        setChecked(true);
      }
    }).catch(() => {
      if (!cancelled) setChecked(true);
    });

    return () => { cancelled = true; };
  }, [vkSettings, checked, dismissed]);

  const handleDismiss = () => {
    localStorage.setItem(dismissedKey, "1");
    setDismissed(true);
  };

  if (!selectedCampaignId || dismissed || !isInvalid) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5">
      <div className="flex items-center gap-3 max-w-full">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-200 flex-1 min-w-0">
          <span className="font-medium">Токен ВКонтакте недействителен.</span>
          {" "}Публикации в VK не будут работать.{" "}
          <Link
            href={`/campaigns/${selectedCampaignId}`}
            className="inline-flex items-center gap-1 underline font-medium hover:no-underline"
          >
            <Settings className="h-3 w-3" />
            Обновить токен
          </Link>
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
