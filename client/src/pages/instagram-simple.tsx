import React from 'react';
import { useLocation } from 'wouter';
import InstagramSetupWizard from '@/components/InstagramSetupWizard';
import { useCampaignStore } from '@/lib/campaignStore';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Страница /settings/instagram-setup.
 *
 * Мастеру обязательны campaignId, onComplete и onCancel — раньше он вызывался
 * вообще без пропсов, поэтому настройка привязывалась к `undefined`-кампании, а
 * «Отмена» падала на вызове undefined (находка ревью 2026-07-28).
 */
const InstagramSimplePage: React.FC = () => {
  const [, navigate] = useLocation();
  const { selectedCampaign } = useCampaignStore();

  const goBack = () => navigate('/campaigns');

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Подключение Instagram Business
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mt-2">
          Настройка публикации контента в Instagram через Facebook Business API
        </p>
      </div>

      {selectedCampaign?.id ? (
        <InstagramSetupWizard
          campaignId={selectedCampaign.id}
          onComplete={goBack}
          onCancel={goBack}
        />
      ) : (
        <Alert>
          <AlertDescription>
            Сначала выберите кампанию — Instagram подключается к конкретной кампании.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default InstagramSimplePage;
