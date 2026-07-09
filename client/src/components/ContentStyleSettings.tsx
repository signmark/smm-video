import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2, RefreshCw, FileText, Upload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface StyleData {
  tone?: string;
  vocabulary?: string;
  sentenceStructure?: string;
  emojiUsage?: string;
  formattingPatterns?: string;
  hashtagStyle?: string;
  callToAction?: string;
  averagePostLength?: string;
  distinctiveFeatures?: string;
}

interface ContentStyle {
  analyzedAt: string;
  rawPostCount: number;
  style: StyleData;
  samplePosts: string;
}

interface ContentStyleSettingsProps {
  campaignId: string;
  initialStyle?: ContentStyle | null;
  onStyleUpdated?: () => void;
}

const STYLE_LABELS: Record<keyof StyleData, string> = {
  tone: 'Тон',
  vocabulary: 'Лексика',
  sentenceStructure: 'Структура предложений',
  emojiUsage: 'Эмодзи',
  formattingPatterns: 'Форматирование',
  hashtagStyle: 'Хештеги',
  callToAction: 'Призывы к действию',
  averagePostLength: 'Длина поста',
  distinctiveFeatures: 'Фирменные особенности',
};

function parseHtmlToText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const messages = doc.querySelectorAll('.message, .text-message, [data-message-id]');
  if (messages.length > 0) {
    return Array.from(messages)
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  return doc.body?.textContent?.trim() || '';
}

export function ContentStyleSettings({ campaignId, initialStyle, onStyleUpdated }: ContentStyleSettingsProps) {
  const { toast } = useToast();
  const [inputMode, setInputMode] = useState<'text' | 'files'>('text');
  const [textPosts, setTextPosts] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; content: string; size: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getAllPostsText = useCallback(() => {
    const fileTexts = uploadedFiles.map((f) => f.content).join('\n\n');
    return [textPosts, fileTexts].filter(Boolean).join('\n\n');
  }, [textPosts, uploadedFiles]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const posts = getAllPostsText();
      if (posts.length < 50) {
        throw new Error('Минимум 50 символов текста для анализа');
      }

      const response = await apiRequest(`/api/campaigns/${campaignId}/analyze-style`, {
        method: 'POST',
        data: { posts },
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: 'Стиль проанализирован', description: 'Результаты сохранены' });
      setTextPosts('');
      setUploadedFiles([]);
      onStyleUpdated?.();
    },
    onError: (error: any) => {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/campaigns/${campaignId}/content-style`, {
        method: 'DELETE',
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Стиль удалён' });
      onStyleUpdated?.();
    },
    onError: (error: any) => {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    },
  });

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newFiles: { name: string; content: string; size: number }[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        let content: string;

        if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
          content = parseHtmlToText(text);
        } else {
          content = text;
        }

        if (content.trim()) {
          newFiles.push({ name: file.name, content, size: file.size });
        }
      } catch {
        toast({ title: `Ошибка чтения ${file.name}`, variant: 'destructive' });
      }
    }

    setUploadedFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [toast]);

  const removeFile = useCallback((index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`;
    return `${(bytes / 1024).toFixed(1)} КБ`;
  };

  if (initialStyle?.style) {
    const style = initialStyle.style;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <span className="text-sm text-muted-foreground">
              Проанализировано {initialStyle.rawPostCount} постов ·{' '}
              {new Date(initialStyle.analyzedAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Удалить
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(STYLE_LABELS).map(([key, label]) => {
            const value = style[key as keyof StyleData];
            if (!value) return null;
            return (
              <Card key={key} className="py-3">
                <CardContent className="px-4">
                  <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
                  <p className="text-sm">{value}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTextPosts('');
              setUploadedFiles([]);
              setInputMode('text');
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Проанализировать заново
          </Button>
        </div>

        {inputMode === 'text' || !initialStyle ? (
          <div className="pt-2">
            <Textarea
              value={textPosts}
              onChange={(e) => setTextPosts(e.target.value)}
              placeholder="Вставьте посты для повторного анализа..."
              className="min-h-[150px]"
            />
            <Button
              className="mt-2"
              size="sm"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending || getAllPostsText().length < 50}
            >
              {analyzeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Проанализировать
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            inputMode === 'text'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setInputMode('text')}
        >
          <FileText className="h-4 w-4 mr-1 inline" />
          Текст
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            inputMode === 'files'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setInputMode('files')}
        >
          <Upload className="h-4 w-4 mr-1 inline" />
          Файлы
        </button>
      </div>

      {inputMode === 'text' ? (
        <Textarea
          value={textPosts}
          onChange={(e) => setTextPosts(e.target.value)}
          placeholder="Вставьте ваши посты через пустую строку...&#10;&#10;Пост 1&#10;&#10;Пост 2&#10;&#10;Пост 3"
          className="min-h-[200px]"
        />
      ) : (
        <div className="space-y-3">
          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Нажмите или перетащите файлы
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Любой формат: .txt, .html, .md и др.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />

          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              {uploadedFiles.map((file, i) => (
                <div key={i} className="flex items-center justify-between bg-muted rounded px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{file.name}</span>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {formatSize(file.size)}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0"
                    onClick={() => removeFile(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        onClick={() => analyzeMutation.mutate()}
        disabled={analyzeMutation.isPending || getAllPostsText().length < 50}
      >
        {analyzeMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        {analyzeMutation.isPending ? 'Анализ...' : 'Проанализировать стиль'}
      </Button>
    </div>
  );
}
