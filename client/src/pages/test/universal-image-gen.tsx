import React from 'react';
import { ImageGenerationTester } from '@/components/ImageGenerationTester';

export default function UniversalImageGenPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Универсальная генерация изображений FAL.AI</h1>
      <p className="text-gray-600 mb-6">
        Тестирование универсального интерфейса для генерации изображений с использованием различных моделей FAL.AI
      </p>
      
      <div className="bg-white p-6 rounded-lg shadow-md">
        <ImageGenerationTester />
      </div>
    </div>
  );
}