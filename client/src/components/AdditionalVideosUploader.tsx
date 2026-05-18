import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VideoUploader } from "./VideoUploader";
import { Plus, Trash2 } from "lucide-react";

interface AdditionalVideosUploaderProps {
  videos: string[];
  onChange: (videos: string[]) => void;
  label?: string;
}

export function AdditionalVideosUploader({ 
  videos = [], 
  onChange, 
  label = "Дополнительные видео" 
}: AdditionalVideosUploaderProps) {
  
  // Обработчик изменения URL видео
  const handleVideoChange = (index: number, url: string) => {
    const updatedVideos = [...videos];
    updatedVideos[index] = url;
    onChange(updatedVideos);
  };
  
  // Обработчик удаления видео
  const handleRemoveVideo = (index: number) => {
    const updatedVideos = [...videos];
    updatedVideos.splice(index, 1);
    onChange(updatedVideos);
  };
  
  // Обработчик добавления нового видео
  const handleAddVideo = () => {
    onChange([...videos, ""]);
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
          onClick={handleAddVideo}
        >
          <Plus className="h-4 w-4 mr-1" />
          Добавить видео
        </Button>
      </div>
      
      {videos.length > 0 ? (
        <div className="space-y-3">
          {videos.map((videoUrl, index) => (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-start">
                <div className="flex-1">
                  <VideoUploader
                    id={`additional-video-${index}`}
                    value={videoUrl}
                    onChange={(url) => handleVideoChange(index, url)}
                    placeholder="Введите URL дополнительного видео"
                    forcePreview={true}
                  />
                </div>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="icon"
                  className="h-9 w-9 mt-1 ml-2 flex-none"
                  onClick={() => handleRemoveVideo(index)}
                  aria-label="Удалить видео"
                >
                  <span className="sr-only">Удалить</span>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic">
          Нет дополнительных видео. Нажмите кнопку "Добавить видео", чтобы добавить.
        </div>
      )}
    </div>
  );
}