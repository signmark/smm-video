import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { MediaItem } from '../../shared/schema';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Card, 
  CardContent, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Trash2, 
  Upload, 
  Link as LinkIcon, 
  Image as ImageIcon, 
  Video as VideoIcon,
  Info,
  X,
  Edit,
  ExternalLink
} from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { uploadImageToBegetS3 } from '@/lib/s3Client';
import { uploadVideoToBegetS3 } from '@/lib/s3VideoClient';
import { toast } from '@/hooks/use-toast';
import { Spinner } from './ui/spinner';

interface MediaUploaderProps {
  value: MediaItem[] | null;
  onChange: (value: MediaItem[]) => void;
  maxItems?: number;
  title?: string;
  hideTitle?: boolean;
}

/**
 * Универсальный компонент для загрузки и управления медиафайлами (изображения и видео)
 * Поддерживает локальную загрузку файлов и добавление URL
 */
export const MediaUploader: React.FC<MediaUploaderProps> = ({
  value = null,
  onChange,
  maxItems = 10,
  title = "Дополнительные медиафайлы",
  hideTitle = false
}) => {
  const [mediaList, setMediaList] = useState<MediaItem[]>(value || []);
  const [selectedType, setSelectedType] = useState<'image' | 'video'>('image');
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Обновляем медиа при изменении value из props
  useEffect(() => {
    if (value !== null) {
      setMediaList(value);
    }
  }, [value]);

  // Обновляем родительский компонент при изменении медиасписка
  useEffect(() => {
    onChange(mediaList);
  }, [mediaList, onChange]);

  // Проверяет тип файла по расширению
  const isImageFile = (fileName: string): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const lowerCaseFilename = fileName.toLowerCase();
    return imageExtensions.some(ext => lowerCaseFilename.endsWith(ext));
  };

  const isVideoFile = (fileName: string): boolean => {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v'];
    const lowerCaseFilename = fileName.toLowerCase();
    return videoExtensions.some(ext => lowerCaseFilename.endsWith(ext));
  };

  // Обработчик загрузки файлов через кнопку "Выбрать файл"
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Проверка на превышение лимита файлов
    if (mediaList.length + files.length > maxItems) {
      toast({
        title: "Превышен лимит файлов",
        description: `Максимальное количество файлов: ${maxItems}`,
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);

    try {
      // Обрабатываем каждый файл
      const newMediaItems: MediaItem[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name;

        let fileType: 'image' | 'video';
        let uploadResult: { url: string } | null = null;

        // Определяем тип файла и загружаем соответствующим способом
        if (isImageFile(fileName)) {
          fileType = 'image';
          uploadResult = await uploadImageToBegetS3(file);
        } else if (isVideoFile(fileName)) {
          fileType = 'video';
          uploadResult = await uploadVideoToBegetS3(file);
        } else {
          toast({
            title: "Неподдерживаемый формат файла",
            description: "Поддерживаются только изображения (jpg, png, gif и т.д.) и видео (mp4, webm и т.д.)",
            variant: "destructive"
          });
          continue;
        }

        if (uploadResult && uploadResult.url) {
          newMediaItems.push({
            url: uploadResult.url,
            type: fileType,
            title: fileName,
            description: ''
          });
        } else {
          toast({
            title: "Ошибка загрузки",
            description: `Не удалось загрузить файл: ${fileName}`,
            variant: "destructive"
          });
        }
      }

      // Добавляем новые медиафайлы в список
      setMediaList(prev => [...prev, ...newMediaItems]);

      toast({
        title: "Файлы загружены",
        description: `Успешно загружено ${newMediaItems.length} файлов`,
        variant: "default"
      });
    } catch (error) {
      console.error("Ошибка при загрузке файлов:", error);
      toast({
        title: "Ошибка загрузки",
        description: "Произошла ошибка при загрузке файлов. Пожалуйста, попробуйте еще раз.",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Обработчик добавления медиафайла по URL
  const handleAddByUrl = () => {
    // Проверка URL
    if (!urlInput.trim()) {
      toast({
        title: "Пустой URL",
        description: "Пожалуйста, введите корректный URL медиафайла",
        variant: "destructive"
      });
      return;
    }

    // Проверка на превышение лимита файлов
    if (mediaList.length >= maxItems) {
      toast({
        title: "Превышен лимит файлов",
        description: `Максимальное количество файлов: ${maxItems}`,
        variant: "destructive"
      });
      return;
    }

    // Создаем новый элемент медиа
    const newMedia: MediaItem = {
      url: urlInput,
      type: selectedType,
      title: titleInput || urlInput.split('/').pop() || urlInput,
      description: descriptionInput || ''
    };

    // Если мы редактируем существующий элемент
    if (editingIndex !== null) {
      const updatedList = [...mediaList];
      updatedList[editingIndex] = newMedia;
      setMediaList(updatedList);
      setEditingIndex(null);
    } else {
      // Добавляем новый элемент
      setMediaList(prev => [...prev, newMedia]);
    }

    // Сбрасываем форму
    setUrlInput('');
    setTitleInput('');
    setDescriptionInput('');
    setDialogOpen(false);
    setEditDialogOpen(false);
  };

  // Удаляет медиафайл по индексу
  const handleRemoveMedia = (index: number) => {
    setMediaList(prev => prev.filter((_, i) => i !== index));
  };

  // Открывает диалог редактирования медиафайла
  const handleEditMedia = (index: number) => {
    const media = mediaList[index];
    setEditingIndex(index);
    setUrlInput(media.url);
    setSelectedType(media.type);
    setTitleInput(media.title || '');
    setDescriptionInput(media.description || '');
    setEditDialogOpen(true);
  };

  // Рендер карточки медиафайла
  const renderMediaCard = (media: MediaItem, index: number) => {
    return (
      <Card key={`${media.url}-${index}`} className="mb-2 overflow-hidden">
        <CardHeader className="p-3 pb-0">
          <CardTitle className="text-sm font-medium flex justify-between items-center">
            <div className="flex items-center truncate">
              {media.type === 'image' ? <ImageIcon size={16} className="mr-1" /> : <VideoIcon size={16} className="mr-1" />}
              <span className="truncate">{media.title || media.url.split('/').pop() || 'Медиафайл'}</span>
            </div>
            <div className="flex-shrink-0 flex gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7" 
                onClick={() => handleEditMedia(index)}
              >
                <Edit size={14} />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                    <Trash2 size={14} />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Удалить медиафайл?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Медиафайл будет удален из списка. Это действие нельзя отменить.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction 
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => handleRemoveMedia(index)}
                    >
                      Удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground truncate">
            <a 
              href={media.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center hover:underline"
            >
              <ExternalLink size={12} className="mr-1" />
              {media.url}
            </a>
          </div>
          {media.description && (
            <div className="mt-1 text-xs text-gray-500">
              {media.description.length > 50 
                ? `${media.description.slice(0, 50)}...` 
                : media.description
              }
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-3 my-4">
      {!hideTitle && <h3 className="text-md font-medium mb-2">{title}</h3>}

      <div className="flex flex-wrap gap-2 mb-3">
        {/* Кнопка загрузки файла */}
        <Button 
          variant="outline" 
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || mediaList.length >= maxItems}
          className="flex items-center gap-1"
        >
          {isUploading ? <Spinner size="sm" /> : <Upload size={16} className="mr-1" />}
          {isUploading ? "" : "Загрузить файл"}
        </Button>

        {/* Кнопка добавления URL */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              variant="outline" 
              onClick={() => {
                setEditingIndex(null);
                setUrlInput('');
                setTitleInput('');
                setDescriptionInput('');
                setSelectedType('image');
              }}
              disabled={mediaList.length >= maxItems}
              className="flex items-center gap-1"
            >
              <LinkIcon size={16} />
              Добавить по URL
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Добавить медиафайл по URL</DialogTitle>
              <DialogDescription>
                Введите URL медиафайла и дополнительную информацию
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="media-type">Тип медиафайла</Label>
                <Select 
                  value={selectedType} 
                  onValueChange={(value) => setSelectedType(value as 'image' | 'video')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тип медиа" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">Изображение</SelectItem>
                    <SelectItem value="video">Видео</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="media-url">URL медиафайла</Label>
                <Input 
                  id="media-url" 
                  placeholder="https://example.com/media.jpg" 
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="media-title">Заголовок (необязательно)</Label>
                <Input 
                  id="media-title" 
                  placeholder="Заголовок медиафайла" 
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="media-description">Описание (необязательно)</Label>
                <Textarea 
                  id="media-description" 
                  placeholder="Описание медиафайла" 
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button onClick={handleAddByUrl}>Добавить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Диалог редактирования */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Редактировать медиафайл</DialogTitle>
              <DialogDescription>
                Измените информацию о медиафайле
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="edit-media-type">Тип медиафайла</Label>
                <Select 
                  value={selectedType} 
                  onValueChange={(value) => setSelectedType(value as 'image' | 'video')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тип медиа" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">Изображение</SelectItem>
                    <SelectItem value="video">Видео</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-media-url">URL медиафайла</Label>
                <Input 
                  id="edit-media-url" 
                  placeholder="https://example.com/media.jpg" 
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-media-title">Заголовок (необязательно)</Label>
                <Input 
                  id="edit-media-title" 
                  placeholder="Заголовок медиафайла" 
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-media-description">Описание (необязательно)</Label>
                <Textarea 
                  id="edit-media-description" 
                  placeholder="Описание медиафайла" 
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Отмена</Button>
              <Button onClick={handleAddByUrl}>Сохранить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Счетчик файлов */}
      <div className="text-sm text-muted-foreground mb-3">
        {mediaList.length} из {maxItems} медиафайлов
      </div>

      {/* Список загруженных медиафайлов */}
      <div className="space-y-2">
        {mediaList.length === 0 ? (
          <div className="text-center py-6 border-2 border-dashed rounded-md">
            <p className="text-muted-foreground">Нет добавленных медиафайлов</p>
            <p className="text-xs text-muted-foreground mt-1">
              Загрузите файлы или добавьте по URL
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {mediaList.map((media, index) => renderMediaCard(media, index))}
          </div>
        )}
      </div>

      {/* Скрытый input для загрузки файлов */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        multiple
        accept="image/*,video/*"
        style={{ display: 'none' }}
      />
    </div>
  );
};

export default MediaUploader;