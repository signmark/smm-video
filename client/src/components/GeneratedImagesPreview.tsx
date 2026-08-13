/**
 * SM-27: сетка сгенерированных картинок с крупным просмотром.
 *
 * Просмотр и выбор разведены намеренно. Клик по превью, как и раньше, ВЫБИРАЕТ
 * картинку — это основное действие диалога, ломать его нельзя. Крупный просмотр
 * висит отдельной кнопкой-лупой в углу превью и гасит всплытие, поэтому открыть
 * картинку крупно и при этом случайно сменить выбор невозможно.
 *
 * Собственного зум-движка здесь нет: показываем оригинал в натуральную величину
 * и даём прокрутку — этого достаточно, чтобы разглядеть детали, и не тянет
 * лишнюю библиотеку. Модалка — тот же shadcn Dialog, что и везде; он же даёт
 * закрытие по Esc и по клику вне и роль диалога. Возврат фокуса на лупу, с
 * которой открыли, сделан явно: авто-возврат Radix зависит от того, что было
 * сфокусировано в момент монтирования, и это не то же самое, что «кнопка, по
 * которой кликнули». Явная ссылка на элемент надёжнее и проверяется тестом.
 */
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ZoomIn } from "lucide-react";

interface GeneratedImagesPreviewProps {
  images: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function GeneratedImagesPreview({ images, selectedIndex, onSelect }: GeneratedImagesPreviewProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const openedFromRef = useRef<HTMLButtonElement | null>(null);
  const previewUrl = previewIndex === null ? null : images[previewIndex];

  return (
    <>
      <div className={`grid ${images.length > 2 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 generated-images-grid`}>
        {images.map((imageUrl, index) => (
          <div
            key={index}
            className={`relative rounded-md overflow-hidden border-2 cursor-pointer ${selectedIndex === index ? 'border-primary' : 'border-transparent'}`}
            onClick={() => onSelect(index)}
          >
            <div className="w-full aspect-square bg-gray-100 flex items-center justify-center relative">
              <img
                src={imageUrl}
                alt={`Изображение ${index + 1}`}
                className="w-full h-auto object-cover aspect-square"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
              <button
                type="button"
                aria-label={`Открыть изображение ${index + 1} крупно`}
                title="Открыть крупно"
                className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white"
                // Всплытие гасим здесь: иначе лупа заодно меняла бы выбор.
                onClick={(event) => {
                  event.stopPropagation();
                  openedFromRef.current = event.currentTarget;
                  setPreviewIndex(index);
                }}
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={previewIndex !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewIndex(null);
        }}
      >
        <DialogContent
          className="max-w-[95vw] sm:max-w-[90vw]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openedFromRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Изображение ${(previewIndex ?? 0) + 1} из ${images.length}`}</DialogTitle>
            <DialogDescription>
              Оригинал в натуральную величину. Закрыть — Esc или клик вне окна; выбор картинки не меняется.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-auto">
            {previewUrl && (
              <img
                src={previewUrl}
                alt={`Изображение ${(previewIndex ?? 0) + 1} крупно`}
                className="max-w-none"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
