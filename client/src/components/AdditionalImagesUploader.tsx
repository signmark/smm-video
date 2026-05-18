import { Button } from "@/components/ui/button";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ImageUploader } from "@/components/ImageUploader";

interface AdditionalImagesUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  label?: string;
  onGenerateImage?: (index: number) => void;
}

export function AdditionalImagesUploader({ 
  images = [], 
  onChange, 
  label = "Дополнительные изображения",
  onGenerateImage
}: AdditionalImagesUploaderProps) {
  
  // Обработчик изменения URL изображения
  const handleImageChange = (index: number, url: string) => {
    const updatedImages = [...images];
    updatedImages[index] = url;
    onChange(updatedImages);
  };
  
  // Обработчик удаления изображения
  const handleRemoveImage = (index: number) => {
    const updatedImages = [...images];
    updatedImages.splice(index, 1);
    onChange(updatedImages);
  };
  
  // Обработчик добавления нового изображения
  const handleAddImage = () => {
    onChange([...images, ""]);
  };
  
  // Функция для отображения URL
  const displayUrl = (url: string) => {
    if (!url || url.trim() === '') return 'Пустой URL';
    return url.length > 50 ? url.substring(0, 47) + '...' : url;
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center mb-2">
        <Label>{label}</Label>
        <Button 
          type="button" 
          variant="outline" 
          size="sm"
          onClick={handleAddImage}
        >
          <Plus className="h-4 w-4 mr-1" />
          Добавить изображение
        </Button>
      </div>
      
      {images.length > 0 ? (
        <div className="space-y-3">
          {images.map((imageUrl, index) => (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-start">
                <div className="flex-1">
                  <ImageUploader
                    id={`additional-image-${index}`}
                    value={imageUrl}
                    onChange={(url) => handleImageChange(index, url)}
                    placeholder="Введите URL дополнительного изображения"
                    forcePreview={true}
                  />
                </div>
                {onGenerateImage && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="icon"
                    className="h-9 w-9 mt-1 ml-2 flex-none bg-blue-50 border-blue-200 hover:bg-blue-100"
                    onClick={() => onGenerateImage(index)}
                    aria-label="Сгенерировать изображение"
                  >
                    <span className="sr-only">Сгенерировать</span>
                    <Wand2 className="h-4 w-4" />
                  </Button>
                )}
                <Button 
                  type="button" 
                  variant="outline" 
                  size="icon"
                  className="h-9 w-9 mt-1 ml-2 flex-none"
                  onClick={() => handleRemoveImage(index)}
                  aria-label="Удалить изображение"
                >
                  <span className="sr-only">Удалить</span>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {imageUrl && imageUrl.trim() !== '' && (
                <div className="text-xs text-muted-foreground ml-1 break-all">
                  URL: {displayUrl(imageUrl)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Нет дополнительных изображений. Нажмите "Добавить изображение" для добавления.
        </p>
      )}
    </div>
  );
}