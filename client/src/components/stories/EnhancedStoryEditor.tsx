import React, { useState, useEffect } from 'react';
import { useCampaignStore } from '@/lib/campaignStore';
import { useParams } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
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
  
  // Определяем активный campaignId с приоритетом URL параметру.
  // Дефолта нет намеренно: раньше здесь стоял хардкод чужой кампании, и Stories
  // новых пользователей уезжали в неё.
  const activeCampaignId = propCampaignId || urlCampaignId || selectedCampaign?.id || '';
  const activeStoryId = propStoryId || storyId;

  const [selectedMode, setSelectedMode] = useState<StoryMode | null>(null);

  // СТАБИЛЬНАЯ инициализация режима - только один раз при монтированию
  useEffect(() => {
    if (activeStoryId && selectedMode === null) {
      setSelectedMode('simple');
    }
  }, [activeStoryId, selectedMode]);

  // Кампания не выбрана — создавать Stories некуда
  if (!activeCampaignId) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-medium text-muted-foreground mb-2">Выберите кампанию</h3>
              <p className="text-sm text-muted-foreground">
                Для создания Stories выберите кампанию в селекторе выше или создайте новую
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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