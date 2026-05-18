import React, { useState, useEffect } from 'react';
import { useCampaignStore } from '@/lib/campaignStore';
import { useParams } from 'wouter';
import StoryModeSelector, { StoryMode } from './StoryModeSelector';
import SimpleStoryEditor from './SimpleStoryEditor';
import SimpleVideoEditor from './SimpleVideoEditor';

interface EnhancedStoryEditorProps {
  campaignId?: string;
  storyId?: string;
}

export default function EnhancedStoryEditor({ campaignId: propCampaignId, storyId: propStoryId }: EnhancedStoryEditorProps) {
  const { campaignId: urlCampaignId, storyId } = useParams();
  const selectedCampaign = useCampaignStore((state) => state.selectedCampaign);
  
  // Определяем активный campaignId с приоритетом URL параметру
  const activeCampaignId = propCampaignId || urlCampaignId || selectedCampaign?.id || "46868c44-c6a4-4bed-accf-9ad07bba790e";
  const activeStoryId = propStoryId || storyId;

  const [selectedMode, setSelectedMode] = useState<StoryMode | null>(null);

  // СТАБИЛЬНАЯ инициализация режима - только один раз при монтированию
  useEffect(() => {
    if (activeStoryId && selectedMode === null) {
      setSelectedMode('simple');
    }
  }, [activeStoryId, selectedMode]);

  // Если режим не выбран и нет storyId, показываем селектор
  if (!selectedMode) {
    return (
      <StoryModeSelector 
        onModeSelect={setSelectedMode}
        campaignId={activeCampaignId}
      />
    );
  }

  // Функция для возврата к селектору режимов
  const handleBack = () => {
    setSelectedMode(null);
  };

  // Рендерим соответствующий редактор
  if (selectedMode === 'simple' && activeStoryId) {
    return (
      <SimpleStoryEditor 
        key={`${activeCampaignId}-${activeStoryId}`}
        campaignId={activeCampaignId}
        storyId={activeStoryId}
      />
    );
  }

  if (selectedMode === 'video') {
    return (
      <SimpleVideoEditor 
        campaignId={activeCampaignId}
        onBack={handleBack}
      />
    );
  }

  return null;
}