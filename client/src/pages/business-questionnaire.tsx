import React from 'react';
import { useParams } from 'wouter';
import { BusinessQuestionnaireForm } from '@/components/BusinessQuestionnaireForm';

export default function BusinessQuestionnairePage() {
  const params = useParams();
  const campaignId = params.id;

  if (!campaignId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Ошибка</h1>
          <p className="mt-2">ID кампании не найден</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <BusinessQuestionnaireForm campaignId={campaignId} />
    </div>
  );
}