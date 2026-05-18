import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface SimpleRichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}

export function SimpleRichTextEditor({
  value,
  onChange,
  placeholder = 'Начните вводить текст...',
  minHeight = 150,
  className,
}: SimpleRichTextEditorProps) {
  const [text, setText] = useState(value || '');

  // Синхронизация внешнего значения с внутренним состоянием
  useEffect(() => {
    // Проверяем значение на null или undefined и устанавливаем пустую строку в этом случае
    setText(value || '');
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setText(newValue);
    onChange(newValue);
  };

  return (
    <div className={cn("border border-input rounded-md overflow-hidden", className)}>
      <div className="border-b p-2 bg-muted/20 flex items-center justify-between">
        <span className="text-sm font-medium">Редактор текста</span>
      </div>
      <textarea
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full p-3 focus:outline-none resize-both"
        style={{ 
          minHeight: `${minHeight}px`,
          height: `${minHeight}px`,
        }}
      />
    </div>
  );
}