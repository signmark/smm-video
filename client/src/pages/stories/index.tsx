import { useParams } from "wouter";
import { useMemo } from "react";
import EnhancedStoryEditor from "@/components/stories/EnhancedStoryEditor";
import { useCampaignStore } from "@/lib/campaignStore";

export default function StoriesPage() {
  const { campaignId, storyId } = useParams();
  const selectedCampaign = useCampaignStore((state) => state.selectedCampaign);
  
  // Стабилизируем campaignId с приоритетом URL параметру
  const activeCampaignId = useMemo(() => {
    return campaignId || selectedCampaign?.id || "46868c44-c6a4-4bed-accf-9ad07bba790e";
  }, [campaignId, selectedCampaign?.id]);

  // Если storyId отсутствует, это новая Stories - очищаем состояние
  const cleanStoryId = storyId || undefined;

  return (
    <div className="min-h-screen">
      <div className="max-w-full mx-auto">
        <EnhancedStoryEditor campaignId={activeCampaignId} storyId={cleanStoryId} />
      </div>
    </div>
  );
}