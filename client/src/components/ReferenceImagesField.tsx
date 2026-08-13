/**
 * SM-26: поле образцов для генерации по образцу.
 *
 * Раньше поле просто не существовало, пока не выбрана нужная модель, — из-за
 * этого про саму возможность никто не знал. Теперь место занято всегда: при
 * неподдерживающей модели здесь одна строка, которая говорит, где эта
 * возможность живёт. Это подсказка, а не блокировка и не всплывашка: выбор
 * модели она не меняет и ничего не запрещает.
 */
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_REFERENCE_IMAGES,
  REFERENCE_MODEL_LABEL,
  supportsReference,
} from '@/components/image-generation/reference-models';

interface ReferenceImagesFieldProps {
  /** Выбранная сейчас модель генерации. */
  modelId: string;
  /** Приложенные образцы: ссылки или data:URL загруженных файлов. */
  urls: string[];
  onChange: (urls: string[]) => void;
}

export function ReferenceImagesField({ modelId, urls, onChange }: ReferenceImagesFieldProps) {
  const [draft, setDraft] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  if (!supportsReference(modelId)) {
    return (
      <p className="mb-3 text-xs text-muted-foreground" data-testid="reference-hint">
        📷 Генерация по образцу доступна в модели «{REFERENCE_MODEL_LABEL}»
      </p>
    );
  }

  const isFull = urls.length >= MAX_REFERENCE_IMAGES;

  const add = (value: string) => {
    const clean = value.trim();
    // Дубли молча пропускаем: два одинаковых образца тратят предел впустую.
    if (!clean || isFull || urls.includes(clean)) return;
    onChange([...urls, clean]);
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    // Читаем ровно столько файлов, сколько влезает в остаток предела.
    Array.from(files)
      .slice(0, MAX_REFERENCE_IMAGES - urls.length)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result;
          if (typeof base64 === 'string') add(base64);
        };
        reader.readAsDataURL(file);
      });
  };

  return (
    <div
      className={`mb-3 p-3 border rounded-lg transition-colors ${
        urls.length === 0 ? 'border-destructive/50 bg-destructive/5' : 'bg-muted/30'
      }`}
      data-testid="reference-field"
    >
      <Label className="text-sm font-medium mb-2 flex items-center justify-between">
        <span>
          📷 Образцы для генерации <span className="text-destructive">*</span>
        </span>
        <span className="text-xs font-normal text-muted-foreground" data-testid="reference-counter">
          {urls.length} из {MAX_REFERENCE_IMAGES}
        </span>
      </Label>

      <div className="flex gap-2">
        <Input
          type="url"
          value={draft}
          disabled={isFull}
          data-testid="reference-url-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
              setDraft('');
            }
          }}
          placeholder="Вставьте ссылку на изображение…"
          className="h-9"
        />
        <button
          type="button"
          data-testid="reference-add"
          disabled={isFull || !draft.trim()}
          onClick={() => {
            add(draft);
            setDraft('');
          }}
          className="px-3 h-9 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          Добавить
        </button>
      </div>

      <div className="flex gap-2 mt-2 items-center">
        <label className={isFull ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            disabled={isFull}
            className="hidden"
            data-testid="reference-upload"
            onChange={(e) => {
              addFiles(e.target.files);
              // Иначе повторный выбор того же файла не даст события change.
              if (fileInput.current) fileInput.current.value = '';
            }}
          />
          <span className="inline-flex items-center px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded-md">
            📁 Загрузить файлы
          </span>
        </label>
        {isFull && (
          <span className="text-xs text-muted-foreground" data-testid="reference-limit">
            Больше {MAX_REFERENCE_IMAGES} образцов за раз не приложить
          </span>
        )}
      </div>

      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {urls.map((url, index) => (
            <div
              key={url}
              className="relative w-20 h-20 rounded-md overflow-hidden border bg-muted"
              data-testid={`reference-item-${index}`}
            >
              <img src={url} alt={`Образец ${index + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                aria-label={`Убрать образец ${index + 1}`}
                data-testid={`reference-remove-${index}`}
                onClick={() => onChange(urls.filter((item) => item !== url))}
                className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center text-xs bg-destructive text-destructive-foreground rounded-full"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
