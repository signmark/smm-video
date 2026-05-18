import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Search, Filter, Clock, User, ArrowLeft, Home, Video, Upload, Plus, Edit, Trash2, MoreVertical } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import VideoRecorder from '@/components/VideoRecorder';
import { useAuthStore } from '@/lib/store';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { AdminDebugger } from '@/components/AdminDebugger';
import { BackendLogs } from '@/components/BackendLogs';
import { useIsAdmin } from '@/hooks/useIsAdmin';

type VideoTutorial = any;

const categoryColors = {
  basics: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  content: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  publishing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  analytics: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

// Компонент для редактирования видео
function EditTutorialDialog({ tutorial, onUpdate }: { tutorial: VideoTutorial; onUpdate: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: tutorial.title,
    description: tutorial.description || '',
    category: tutorial.category
  });
  
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest(`/api/tutorials/${tutorial.id}`, {
        method: 'PUT',
        data: data
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tutorials'] });
      toast({ title: t('tutorials.videoUpdated'), description: t('tutorials.changesSaved') });
      setIsOpen(false);
      onUpdate();
    },
    onError: (error: any) => {
      toast({ 
        title: 'Ошибка', 
        description: error.message || 'Не удалось обновить видео',
        variant: 'destructive'
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  return (
    <>
      <DropdownMenuItem 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        }}
      >
        <Edit className="h-4 w-4 mr-2" />
        {t('common.edit')}
      </DropdownMenuItem>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('tutorials.editVideo')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-title">{t('tutorials.videoTitle')}</Label>
            <Input
              id="edit-title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label htmlFor="edit-description">{t('tutorials.videoDescription')}</Label>
            <Textarea
              id="edit-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
            />
          </div>
          <div>
            <Label htmlFor="edit-category">{t('tutorials.category')}</Label>
            <Select 
              value={formData.category} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basics">Основы</SelectItem>
                <SelectItem value="content">Контент</SelectItem>
                <SelectItem value="publishing">Публикация</SelectItem>
                <SelectItem value="analytics">Аналитика</SelectItem>
                <SelectItem value="advanced">Продвинутые</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? `${t('common.save')}...` : t('common.save')}
            </Button>
          </div>
        </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Компонент для удаления видео  
function DeleteTutorialDialog({ tutorial, onDelete }: { tutorial: VideoTutorial; onDelete: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  
  const deleteMutation = useMutation({
    mutationFn: async () => {
      console.log('🗑️ DELETE mutation called for:', tutorial.id);
      return apiRequest(`/api/tutorials/${tutorial.id}`, {
        method: 'DELETE'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tutorials'] });
      toast({ title: t('tutorials.videoDeleted'), description: t('tutorials.videoDeletedSuccess') });
      setIsOpen(false);
      onDelete();
    },
    onError: (error: any) => {
      console.error('❌ DELETE error:', error);
      toast({ 
        title: 'Ошибка', 
        description: error.message || 'Не удалось удалить видео',
        variant: 'destructive'
      });
    }
  });

  return (
    <>
      <DropdownMenuItem 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('🔴 Delete menu clicked, opening dialog');
          setIsOpen(true);
        }}
        className="text-red-600"
      >
        <Trash2 className="h-4 w-4 mr-2" />
        {t('common.delete')}
      </DropdownMenuItem>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Удалить видео</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Вы уверены, что хотите удалить видео <strong>"{tutorial.title}"</strong>?</p>
            <p className="text-sm text-muted-foreground mt-2">Это действие нельзя будет отменить.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Отмена
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                console.log('🔴 Delete button clicked');
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Удаление...' : 'Удалить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TutorialCard({ tutorial, isAdmin, onUpdate }: { tutorial: VideoTutorial; isAdmin?: boolean; onUpdate?: () => void }) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  
  const categoryLabels = {
    basics: t('tutorials.basics'),
    content: t('tutorials.content'),
    publishing: t('tutorials.publication'),
    analytics: t('tutorials.analytics'),
    advanced: t('tutorials.advanced')
  };
  
  const formatDuration = (duration?: number | string | null) => {
    if (!duration) return '—';
    
    if (typeof duration === 'string') {
      return duration;
    }
    
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (sizeBytes?: number) => {
    if (!sizeBytes) return '';
    const mb = sizeBytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <Card 
      className="group hover:shadow-lg transition-all duration-300 cursor-pointer transform hover:-translate-y-1"
      onClick={() => setLocation(`/help/tutorials/${tutorial.id}`)}
      data-testid={`card-tutorial-${tutorial.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle 
            className="text-lg line-clamp-2 group-hover:text-primary transition-colors"
            data-testid={`text-title-${tutorial.id}`}
          >
            {tutorial.title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge 
              className={`shrink-0 ${categoryColors[tutorial.category as keyof typeof categoryColors] || 'bg-gray-100 text-gray-800'}`}
              data-testid={`badge-category-${tutorial.id}`}
            >
              {categoryLabels[tutorial.category as keyof typeof categoryLabels] || tutorial.category}
            </Badge>
            
            {/* Админские действия */}
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-8 w-8 p-0"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`button-admin-menu-${tutorial.id}`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <EditTutorialDialog tutorial={tutorial} onUpdate={() => onUpdate?.()} />
                  <DeleteTutorialDialog tutorial={tutorial} onDelete={() => onUpdate?.()} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <p 
          className="text-sm text-muted-foreground line-clamp-3 mb-4"
          data-testid={`text-description-${tutorial.id}`}
        >
          {tutorial.description || 'Описание отсутствует'}
        </p>
        
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
          <div className="flex items-center gap-1" data-testid={`text-duration-${tutorial.id}`}>
            <Clock className="h-3 w-3" />
            {formatDuration(tutorial.duration)}
          </div>
          <div className="flex items-center gap-1" data-testid={`text-uploader-${tutorial.id}`}>
            <User className="h-3 w-3" />
            {tutorial.uploaded_by || 'Администратор'}
          </div>
          {tutorial.size_bytes && (
            <span className="text-xs opacity-70" data-testid={`text-size-${tutorial.id}`}>
              {formatFileSize(tutorial.size_bytes)}
            </span>
          )}
        </div>

        <Button
          className="w-full group-hover:bg-primary group-hover:text-primary-foreground"
          variant="outline"
          size="sm"
          data-testid={`button-play-${tutorial.id}`}
        >
          <Play className="h-4 w-4 mr-2" />
          Смотреть видео
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyState({ searchQuery, selectedCategory }: { searchQuery: string, selectedCategory: string }) {
  const [, setLocation] = useLocation();
  
  const isFiltered = searchQuery || selectedCategory !== 'all';
  
  return (
    <div className="text-center py-12" data-testid="empty-state">
      <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
        <Play className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">
        {isFiltered ? 'Ничего не найдено' : 'Пока нет видеоинструкций'}
      </h3>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
        {isFiltered 
          ? 'Попробуйте изменить поисковый запрос или выбрать другую категорию'
          : 'Авторизованные пользователи могут добавлять обучающие видео для помощи пользователям'
        }
      </p>
      
      {isFiltered && (
        <Button 
          variant="outline"
          onClick={() => window.location.reload()}
          data-testid="button-reset-filters"
        >
          <Filter className="h-4 w-4 mr-2" />
          Сбросить фильтры
        </Button>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array(6).fill(0).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader>
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
          </CardHeader>
          <CardContent>
            <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
            <div className="flex gap-4 mb-3">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            </div>
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CategoryUploadForm({ 
  category, 
  categoryLabel, 
  onUploadComplete 
}: { 
  category: string;
  categoryLabel: string;
  onUploadComplete: () => void;
}) {
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    duration: ''
  });

  // Простая загрузка видео через backend (без CORS проблем)
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!recordedBlob) throw new Error('No video file');

      // Создаем FormData для загрузки файла
      const formDataUpload = new FormData();
      
      // Создаем File объект с правильным MIME типом
      const mimeType = recordedBlob.type || 'video/webm';
      const extension = mimeType.startsWith('video/mp4') ? '.mp4' : '.webm';
      const videoFile = new File([recordedBlob], `tutorial${extension}`, { 
        type: mimeType 
      });
      
      formDataUpload.append('video', videoFile);
      formDataUpload.append('title', formData.title);
      formDataUpload.append('description', formData.description);
      formDataUpload.append('category', String(category));

      // Загружаем напрямую через backend
      const response = await fetch('/api/tutorials/upload', {
        method: 'POST',
        body: formDataUpload,
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().token}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Видеоинструкция загружена!",
        description: `Инструкция "${formData.title}" добавлена в "${categoryLabel}"`,
      });
      
      // Обновляем ОБА кэша для отображения нового видео
      queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tutorials'] });
      
      setFormData({ title: '', description: '', duration: '' });
      setRecordedBlob(null);
      onUploadComplete();
    },
    onError: (error: any) => {
      toast({
        title: "Ошибка загрузки",
        description: error.message || "Не удалось загрузить видеоинструкцию",
        variant: "destructive"
      });
      setIsUploading(false);
    }
  });

  const handleRecordingComplete = (blob: Blob, filename: string) => {
    setRecordedBlob(blob);
    const duration = Math.floor(blob.size / (1024 * 100));
    setFormData(prev => ({ ...prev, duration: `${duration}s` }));
    
    toast({
      title: "Запись завершена!",
      description: `Видео готово к загрузке (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`,
    });
  };

  const handleUpload = () => {
    if (!recordedBlob) {
      toast({
        title: "Нет видео для загрузки",
        description: "Сначала запишите видеоинструкцию",
        variant: "destructive"
      });
      return;
    }

    if (!formData.title.trim()) {
      toast({
        title: "Укажите название",
        description: "Введите название для видеоинструкции",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);
    uploadMutation.mutate();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Форма метаданных */}
      <div className="space-y-4">
        <div className="p-4 bg-primary/10 rounded-lg">
          <p className="text-sm font-medium">
            📂 Категория: <span className="text-primary">{categoryLabel}</span>
          </p>
        </div>

        <div>
          <Label htmlFor="title" className="text-sm font-medium">
            Название инструкции *
          </Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            placeholder={`Например: Как создать контент для ${categoryLabel.toLowerCase()}`}
            data-testid="input-tutorial-title"
          />
        </div>

        <div>
          <Label htmlFor="description" className="text-sm font-medium">
            Описание
          </Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Краткое описание того, что показано в инструкции..."
            rows={3}
            data-testid="textarea-description"
          />
        </div>

        {recordedBlob && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <Video className="h-4 w-4" />
              <span className="text-sm font-medium">
                Видео готово ({(recordedBlob.size / (1024 * 1024)).toFixed(1)} MB)
              </span>
            </div>
          </div>
        )}

        <Button
          onClick={handleUpload}
          disabled={!recordedBlob || !formData.title.trim() || isUploading}
          className="w-full"
          data-testid="button-upload-tutorial"
        >
          {isUploading ? (
            <>
              <Upload className="h-4 w-4 mr-2 animate-spin" />
              Загружаю...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Загрузить в "{categoryLabel}"
            </>
          )}
        </Button>
      </div>

      {/* VideoRecorder */}
      <div>
        <VideoRecorder 
          onRecordingComplete={handleRecordingComplete}
          className="h-full"
        />
      </div>
    </div>
  );
}

function SimpleUploadForm({ onUploadComplete }: { onUploadComplete: () => void }) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  
  const categoryLabels = {
    basics: t('tutorials.basics'),
    content: t('tutorials.content'),
    publishing: t('tutorials.publication'),
    analytics: t('tutorials.analytics'),
    advanced: t('tutorials.advanced')
  };
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'basics' as keyof typeof categoryLabels
  });

  // Простая загрузка видео через backend (без CORS проблем)
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('No file selected');

      // Создаем FormData для загрузки файла
      const formDataUpload = new FormData();
      
      // Создаем File объект с правильным MIME типом
      const originalName = selectedFile.name;
      const extension = originalName.split('.').pop()?.toLowerCase();
      
      let mimeType = selectedFile.type;
      // Исправляем MIME тип если он неправильный
      if (!mimeType || mimeType === 'text/plain') {
        if (extension === 'mp4') {
          mimeType = 'video/mp4';
        } else if (extension === 'webm') {
          mimeType = 'video/webm';
        } else {
          mimeType = 'video/webm'; // fallback
        }
      }
      
      const correctedFile = new File([selectedFile], originalName, { 
        type: mimeType 
      });
      
      formDataUpload.append('video', correctedFile);
      formDataUpload.append('title', formData.title);
      formDataUpload.append('description', formData.description);
      formDataUpload.append('category', formData.category);

      // Загружаем напрямую через backend
      const response = await fetch('/api/tutorials/upload', {
        method: 'POST',
        body: formDataUpload,
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().token}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "🎉 Видео загружено!",
        description: `"${formData.title}" добавлено в "${categoryLabels[formData.category]}"`,
      });
      
      // Обновляем кэш для отображения нового видео
      queryClient.invalidateQueries({ queryKey: ['/api/tutorials'] });
      
      setFormData({ title: '', description: '', category: 'basics' });
      setSelectedFile(null);
      onUploadComplete();
    },
    onError: (error: any) => {
      toast({
        title: "Ошибка загрузки",
        description: error.message || "Не удалось загрузить видео",
        variant: "destructive"
      });
      setIsUploading(false);
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Проверяем тип файла
      if (!file.type.startsWith('video/')) {
        toast({
          title: "Неверный тип файла",
          description: "Выберите видеофайл (mp4, webm, avi и т.д.)",
          variant: "destructive"
        });
        return;
      }
      
      setSelectedFile(file);
      toast({
        title: "Файл выбран",
        description: `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
      });
    }
  };

  const handleUpload = () => {
    if (!selectedFile || !formData.title.trim()) {
      toast({
        title: "Заполните данные",
        description: "Выберите файл и укажите название",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);
    uploadMutation.mutate();
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Выбор файла */}
      <div>
        <Label htmlFor="video-file" className="text-sm font-medium mb-2 block">
          Выберите видеофайл *
        </Label>
        <Input
          id="video-file"
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="cursor-pointer"
        />
        {selectedFile && (
          <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded text-sm text-green-700 dark:text-green-300">
            ✓ {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
          </div>
        )}
      </div>

      {/* Название */}
      <div>
        <Label htmlFor="simple-title">Название видео *</Label>
        <Input
          id="simple-title"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Например: Как создать пост в Instagram"
          className="mt-1"
        />
      </div>

      {/* Категория */}
      <div>
        <Label htmlFor="simple-category">Категория *</Label>
        <Select value={formData.category} onValueChange={(value) => setFormData(prev => ({ ...prev, category: value as keyof typeof categoryLabels }))}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Описание */}
      <div>
        <Label htmlFor="simple-description">Описание</Label>
        <Textarea
          id="simple-description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Краткое описание видео..."
          rows={2}
          className="mt-1"
        />
      </div>

      {/* Кнопка загрузки */}
      <Button
        onClick={handleUpload}
        disabled={!selectedFile || !formData.title.trim() || isUploading}
        className="w-full"
        size="lg"
      >
        {isUploading ? (
          <>
            <Upload className="h-4 w-4 mr-2 animate-spin" />
            Загружаю...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </>
        )}
      </Button>
    </div>
  );
}

export default function TutorialsPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  
  // Обновляем categoryLabels с переводами
  const categoryLabels = {
    basics: t('tutorials.basics'),
    content: t('tutorials.content'),
    publishing: t('tutorials.publication'),
    analytics: t('tutorials.analytics'),
    advanced: t('tutorials.advanced')
  };
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [openUploadDialog, setOpenUploadDialog] = useState<string | null>(null);
  const [openMainUploadDialog, setOpenMainUploadDialog] = useState<string | null>(null);
  // Проверка авторизации и роли администратора
  const token = useAuthStore((state) => state.token);
  const isAuthenticated = !!token;

  // Проверка роли администратора через единый хук
  const { data: adminData } = useIsAdmin();
  const isAdmin = adminData?.isAdmin || false;

  // Загрузка tutorials - РЕАЛЬНЫЙ запрос к API с авторизацией
  const { data: tutorialsResponse, isLoading, error: queryError } = useQuery({
    queryKey: ['/api/tutorials'],
  });

  const tutorials = tutorialsResponse?.data || [];
  const error = queryError;


  // Фильтрация tutorials
  const filteredTutorials = useMemo(() => {
    if (!Array.isArray(tutorials)) return [];
    
    return tutorials.filter(tutorial => {
      const matchesSearch = !searchQuery || 
        tutorial.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tutorial.description && tutorial.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        tutorial.tags?.some((tag: string) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = selectedCategory === 'all' || tutorial.category === selectedCategory;
      
      return tutorial.is_active && matchesSearch && matchesCategory;
    });
  }, [tutorials, searchQuery, selectedCategory]);

  // Статистика по категориям - проверяем что это массив
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = { all: 0 };
    
    if (!Array.isArray(tutorials)) return stats;
    
    tutorials.forEach(tutorial => {
      // ИСПРАВЛЕНО: используем is_active (snake_case как в Directus)
      if (tutorial.is_active) {
        stats.all++;
        stats[tutorial.category] = (stats[tutorial.category] || 0) + 1;
      }
    });
    return stats;
  }, [tutorials]);

  // ИСПРАВЛЕНО: toast только в useEffect, а не в render
  useEffect(() => {
    if (error) {
      toast({
        title: t('tutorials.errorLoading'),
        description: t('tutorials.errorLoadingDesc'),
        variant: "destructive"
      });
    }
  }, [error, t, toast]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Хлебные крошки */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation('/')}
          data-testid="button-home"
        >
          <Home className="h-4 w-4 mr-1" />
          {t('common.home')}
        </Button>
        <span>/</span>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation('/help')}
          data-testid="button-help"
        >
          {t('common.help')}
        </Button>
        <span>/</span>
        <span className="font-medium">{t('tutorials.title')}</span>
      </div>

      {/* Заголовок и описание */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4" data-testid="heading-main">
          📚 {t('tutorials.title')}
        </h1>
        <p className="text-xl text-muted-foreground">
          {t('tutorials.subtitle')}
        </p>
      </div>

      {/* Секция "Как создать качественную видео-инструкцию" - только для администраторов */}
      {isAdmin && (
        <Card className="mb-8 bg-gradient-to-r from-red-50 via-orange-50 to-red-50 dark:from-red-950/50 dark:via-orange-950/50 dark:to-red-950/50 border-red-200 dark:border-red-800">
          <CardContent className="p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-100">
                <span className="text-2xl">🎬</span>
                {t('tutorials.createVideo')}
              </h2>
              {/* Кнопка загрузки для админов */}
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="default" className="gap-2 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800">
                      <Video className="h-4 w-4" />
                      {t('tutorials.loadVideo')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Загрузить новое видео</DialogTitle>
                    </DialogHeader>
                    <SimpleUploadForm onUploadComplete={() => {
                      queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
                      queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                    }} />
                  </DialogContent>
                </Dialog>
              </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
                <span className="text-lg">📋</span>
                {t('tutorials.preparation')}
              </h3>
              <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Составьте план действий заранее
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Подготовьте тестовые данные
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Очистите экран от лишних элементов
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Проверьте качество микрофона
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
                <span className="text-lg">🎥</span>
                {t('tutorials.duringRecording')}
              </h3>
              <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Говорите четко и не торопитесь
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Объясняйте каждое действие
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Делайте паузы между шагами
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 dark:text-red-400 font-bold">•</span>
                  Показывайте результат каждого действия
                </li>
              </ul>
            </div>
          </div>
          
          {!isAdmin && (
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
                💡 Авторизованные пользователи могут загружать обучающие видео прямо в эту секцию
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Поиск и фильтры */}
      <div className="mb-8">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Поиск по названию, описанию или тегам..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>

        {/* Карточки категорий с кнопками загрузки */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {/* Карточка "Все" */}
          <Card 
            className={`cursor-pointer transition-all ${selectedCategory === 'all' ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
            onClick={() => setSelectedCategory('all')}
            data-testid="card-category-all"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Все инструкции</h3>
                  <p className="text-sm text-muted-foreground">{categoryStats.all || 0} видео</p>
                </div>
                {selectedCategory === 'all' && (
                  <div className="w-3 h-3 rounded-full bg-primary"></div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Карточки категорий */}
          {Object.entries(categoryLabels).map(([category, label]) => (
            <Card 
              key={category}
              className={`cursor-pointer transition-all ${selectedCategory === category ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
              onClick={() => setSelectedCategory(category)}
              data-testid={`card-category-${category}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{label}</h3>
                    <p className="text-sm text-muted-foreground">{categoryStats[category] || 0} видео</p>
                  </div>
                  {selectedCategory === category && (
                    <div className="w-3 h-3 rounded-full bg-primary"></div>
                  )}
                </div>
                
                {/* Кнопка загрузки для админов */}
                {isAdmin && (
                  <Dialog open={openUploadDialog === category} onOpenChange={(open) => setOpenUploadDialog(open ? category : null)}>
                    <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="w-full text-xs"
                        data-testid={`button-upload-${category}`}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        Добавить инструкцию
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Video className="h-5 w-5" />
                          Добавить инструкцию в "{label}"
                        </DialogTitle>
                      </DialogHeader>
                      <CategoryUploadForm 
                        category={category as keyof typeof categoryLabels}
                        categoryLabel={label}
                        onUploadComplete={() => {
                          queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
                          queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                          setOpenUploadDialog(null);
                        }}
                      />
                    </DialogContent>
                  </Dialog>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Контент */}
      {isLoading && <LoadingSkeleton />}

      {!isLoading && (
        <div className="space-y-8">
          {/* Показываем по категориям */}
          {selectedCategory === 'all' ? (
            Object.entries(categoryLabels).map(([category, label]) => {
              const categoryTutorials = Array.isArray(tutorials) ? tutorials.filter(t => 
                t.is_active && 
                t.category === category &&
                (!searchQuery || 
                  t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase())))
              ) : [];
              
              return (
                <div key={category} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                      <Badge className={categoryColors[category as keyof typeof categoryColors]}>
                        {label}
                      </Badge>
                      <span className="text-muted-foreground text-lg">({categoryTutorials.length})</span>
                    </h2>
                    
                    {/* Кнопка загрузки для админов прямо рядом с заголовком */}
                    {isAdmin && (
                      <Dialog open={openMainUploadDialog === `main-${category}`} onOpenChange={(open) => setOpenMainUploadDialog(open ? `main-${category}` : null)}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="gap-2">
                            <Plus className="h-4 w-4" />
                            Добавить в {label}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl">
                          <DialogHeader>
                            <DialogTitle>Добавить видео в "{label}"</DialogTitle>
                          </DialogHeader>
                          <CategoryUploadForm 
                            category={category as keyof typeof categoryLabels}
                            categoryLabel={label}
                            onUploadComplete={() => {
                              queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
                              queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                              setOpenMainUploadDialog(null);
                            }}
                          />
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                  
                  {categoryTutorials.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {categoryTutorials.map((tutorial) => (
                        <TutorialCard 
                          key={tutorial.id} 
                          tutorial={tutorial} 
                          isAdmin={isAdmin}
                          onUpdate={() => {
                            queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 border-2 border-dashed border-muted rounded-lg">
                      <Video className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h3 className="text-lg font-semibold mb-2">Пока нет видео в "{label}"</h3>
                      <p className="text-muted-foreground mb-4">
                        {isAdmin ? 'Добавьте первое видео в эту категорию' : 'Администраторы могут добавить видео в эту категорию'}
                      </p>
                      {isAdmin && (
                        <Dialog open={openMainUploadDialog === `empty-${category}`} onOpenChange={(open) => setOpenMainUploadDialog(open ? `empty-${category}` : null)}>
                          <DialogTrigger asChild>
                            <Button>
                              <Plus className="h-4 w-4 mr-2" />
                              Добавить первое видео
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl">
                            <DialogHeader>
                              <DialogTitle>Добавить видео в "{label}"</DialogTitle>
                            </DialogHeader>
                            <CategoryUploadForm 
                              category={category as keyof typeof categoryLabels}
                              categoryLabel={label}
                              onUploadComplete={() => {
                                queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
                                queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                                setOpenMainUploadDialog(null);
                              }}
                            />
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Badge className={categoryColors[selectedCategory as keyof typeof categoryColors]}>
                    {categoryLabels[selectedCategory as keyof typeof categoryLabels]}
                  </Badge>
                  <span className="text-muted-foreground text-lg">({filteredTutorials.length})</span>
                </h2>
                
                {/* Кнопка загрузки для выбранной категории */}
                {isAdmin && (
                  <Dialog open={openMainUploadDialog === `selected-${selectedCategory}`} onOpenChange={(open) => setOpenMainUploadDialog(open ? `selected-${selectedCategory}` : null)}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-2">
                        <Plus className="h-4 w-4" />
                        Добавить в {categoryLabels[selectedCategory as keyof typeof categoryLabels]}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
                      <DialogHeader>
                        <DialogTitle>Добавить видео в "{categoryLabels[selectedCategory as keyof typeof categoryLabels]}"</DialogTitle>
                      </DialogHeader>
                      <CategoryUploadForm 
                        category={selectedCategory as keyof typeof categoryLabels}
                        categoryLabel={categoryLabels[selectedCategory as keyof typeof categoryLabels]}
                        onUploadComplete={() => {
                          queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
                          queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                          setOpenMainUploadDialog(null);
                        }}
                      />
                    </DialogContent>
                  </Dialog>
                )}
              </div>

              {filteredTutorials.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredTutorials.map((tutorial) => (
                    <TutorialCard 
                      key={tutorial.id} 
                      tutorial={tutorial} 
                      isAdmin={isAdmin}
                      onUpdate={() => {
                        queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState searchQuery={searchQuery} selectedCategory={selectedCategory} />
              )}
            </div>
          )}
        </div>
      )}

      {!isLoading && filteredTutorials.length === 0 && (
        <EmptyState searchQuery={searchQuery} selectedCategory={selectedCategory} />
      )}
      
    </div>
  );
}