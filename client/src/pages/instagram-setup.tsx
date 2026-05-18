import React from 'react';
import { Layout } from '@/components/Layout';
import InstagramSetupWizard from '@/components/InstagramSetupWizard';

const InstagramSetupPage: React.FC = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Подключение Instagram Business
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Настройте публикацию контента в Instagram через Facebook Business API
          </p>
        </div>
        
        <InstagramSetupWizard />
      </div>
    </Layout>
  );
};

export default InstagramSetupPage;