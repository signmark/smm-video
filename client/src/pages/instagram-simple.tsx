import React from 'react';
import InstagramSetupWizard from '@/components/InstagramSetupWizard';

const InstagramSimplePage: React.FC = () => {
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
      
      <InstagramSetupWizard />
    </div>
  );
};

export default InstagramSimplePage;