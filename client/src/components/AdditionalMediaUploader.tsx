import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VideoUploader } from "./VideoUploader";
import { Plus, Trash2, ImageIcon } from "lucide-react";
import { MediaUploader } from "./MediaUploader";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Интерфейс для элемента медиа
export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  title?: string;
  description?: string;
}

interface AdditionalMediaUploaderProps {
  media: MediaItem[];
  onChange: (media: MediaItem[]) => void;
  label?: string;
}

export function AdditionalMediaUploader({ 
  media = [], 
  onChange, 
  label = "Медиа-файлы" 
}: AdditionalMediaUploaderProps) {

  // Обработчик изменения URL медиа
  const handleMediaUrlChange = (index: number, url: string) => {
    const updatedMedia = [...media];
    updatedMedia[index] = { ...updatedMedia[index], url };
    onChange(updatedMedia);
  };

  // Обработчик изменения типа медиа
  const handleMediaTypeChange = (index: number, type: 'image' | 'video') => {
    const updatedMedia = [...media];
    updatedMedia[index] = { ...updatedMedia[index], type };
    onChange(updatedMedia);
  };

  // Обработчик изменения заголовка медиа
  const handleMediaTitleChange = (index: number, title: string) => {
    const updatedMedia = [...media];
    updatedMedia[index] = { ...updatedMedia[index], title };
    onChange(updatedMedia);
  };

  // Обработчик изменения описания медиа
  const handleMediaDescriptionChange = (index: number, description: string) => {
    const updatedMedia = [...media];
    updatedMedia[index] = { ...updatedMedia[index], description };
    onChange(updatedMedia);
  };

  // Обработчик удаления медиа
  const handleRemoveMedia = (index: number) => {
    const updatedMedia = [...media];
    updatedMedia.splice(index, 1);
    onChange(updatedMedia);
  };

  // Обработчик добавления нового медиа
  const handleAddMedia = (type: 'image' | 'video' = 'image') => {
    onChange([...media, { url: "", type, title: "", description: "" }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <Label>{label}</Label>
        <div className="flex gap-2">
          <Button 
            type="button" 
            variant="outline" 
            size="sm"
            onClick={() => handleAddMedia('image')}
          >
            <ImageIcon className="h-4 w-4 mr-1" />
            Добавить изображение
          </Button>
          <Button 
            type="button" 
            variant="outline" 
            size="sm"
            onClick={() => handleAddMedia('video')}
          >
            <Plus className="h-4 w-4 mr-1" />
            Добавить видео
          </Button>
        </div>
      </div>

      {media.length > 0 ? (
        <div className="space-y-6">
          {media.map((mediaItem, index) => (
            <div key={index} className="border p-4 rounded-md bg-muted/20">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <Select
                    value={mediaItem.type}
                    onValueChange={(value) => handleMediaTypeChange(index, value as 'image' | 'video')}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Тип медиа" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Изображение</SelectItem>
                      <SelectItem value="video">Видео</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm font-medium">#{index + 1}</span>
                </div>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="icon"
                  onClick={() => handleRemoveMedia(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                {/* URL поле с загрузчиком */}
                {mediaItem.type === 'video' ? (
                  <div>
                    <Label htmlFor={`media-url-${index}`} className="mb-1 block">URL видео</Label>
                    <VideoUploader
                      id={`media-url-${index}`}
                      value={mediaItem.url || ""}
                      onChange={(url) => handleMediaUrlChange(index, url)}
                      placeholder="Введите URL видео или загрузите файл"
                      forcePreview={true}
                    />
                  </div>
                ) : (
                  <div>
                    <Label htmlFor={`media-url-${index}`} className="mb-1 block">URL изображения</Label>
                    <Input
                      id={`media-url-${index}`}
                      value={mediaItem.url || ""}
                      onChange={(e) => handleMediaUrlChange(index, e.target.value)}
                      placeholder="Введите URL изображения"
                      className="w-full"
                    />
                    {mediaItem.url && (
                      <div className="mt-2 border rounded-md p-2 bg-muted/20">
                        <div className="text-xs text-muted-foreground mb-1">Предпросмотр изображения:</div>
                        <div className="w-full h-auto rounded-md overflow-hidden bg-muted">
                          <img 
                            src={mediaItem.url} 
                            alt={mediaItem.title || "Preview"} 
                            className="max-w-full h-auto max-h-60"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling!.style.display = 'flex';
                            }}
                          />
                          <div 
                            className="flex-col items-center justify-center text-muted-foreground py-10 hidden"
                            style={{ display: 'none' }}
                          >
                            <ImageIcon className="h-10 w-10 mb-2" />
                            <span>Не удалось загрузить изображение</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Заголовок и описание */}
                <div className="grid grid-cols-1 gap-3 mt-2">
                  <div>
                    <Label htmlFor={`media-title-${index}`} className="mb-1 block">Заголовок (опционально)</Label>
                    <Input
                      id={`media-title-${index}`}
                      value={mediaItem.title || ""}
                      onChange={(e) => handleMediaTitleChange(index, e.target.value)}
                      placeholder="Введите заголовок медиа-файла"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`media-description-${index}`} className="mb-1 block">Описание (опционально)</Label>
                    <Textarea
                      id={`media-description-${index}`}
                      value={mediaItem.description || ""}
                      onChange={(e) => handleMediaDescriptionChange(index, e.target.value)}
                      placeholder="Введите описание медиа-файла"
                      className="resize-none"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-md text-center">
          Нет медиа-файлов. Нажмите кнопку "Добавить изображение" или "Добавить видео", чтобы добавить медиа-контент.
        </div>
      )}
    </div>
  );
}