import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// CSS стили для textarea с ресайзом:
// .resizable-textarea {
//   resize: both;
//   overflow: auto;
//   min-height: 150px;
//   width: 100%;
//   padding: 0.75rem;
//   border: 1px solid hsl(var(--input));
//   border-radius: 0.375rem;
//   outline: none;
//   font-family: inherit;
//   font-size: inherit;
//   line-height: 1.5;
// }

interface TextareaWithResizeProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}

export function TextareaWithResize({
  value,
  onChange,
  placeholder = 'Начните вводить текст...',
  minHeight = 150,
  className,
}: TextareaWithResizeProps) {
  const [text, setText] = useState(value || '');

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
    <textarea
      value={text}
      onChange={handleChange}
      placeholder={placeholder}
      className={cn(
        "resize-both overflow-auto w-full p-3 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary",
        className
      )}
      style={{ 
        minHeight: `${minHeight}px`,
        height: `${minHeight}px`,
      }}
    />
  );
}