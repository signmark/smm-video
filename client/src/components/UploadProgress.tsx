import React from 'react';

/**
 * Компонент для отображения прогресса загрузки без текста, только с анимацией
 */
export function UploadProgress({ 
  isLoading = false, 
  size = 'small',
  label = 'Загрузка...',
  className = '' 
}: {
  isLoading?: boolean;
  size?: 'small' | 'large';
  label?: string;
  className?: string;
}) {
  if (!isLoading) return null;

  // Определяем размер спиннера в зависимости от параметра size
  const spinnerSize = size === 'small' ? 'h-3 w-3' : 'h-8 w-8';
  const spinnerBorder = size === 'small' ? 'border-2' : 'border-4';
  
  // Радикальный подход - только спиннер без текста
  return (
    <div 
      className={`${className}`}
      role="status"
      aria-label={label}
    >
      <div 
        className={`${spinnerSize} ${spinnerBorder} border-primary border-t-transparent rounded-full animate-spin mx-auto`}
        aria-hidden="true"
      />
      {/* Скрытый текст для скринридеров */}
      <span className="sr-only">{label}</span>
    </div>
  );
}