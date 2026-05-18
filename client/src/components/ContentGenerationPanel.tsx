import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Save, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface TrendTopic {
  id: string;
  title: string;
  source_id?: string;
  sourceId?: string;
  reactions: number;
  comments: number;
  views: number;
  created_at?: string;
  createdAt?: string;
  is_bookmarked?: boolean;
  isBookmarked?: boolean;
  campaign_id?: string;
  campaignId?: string;
}

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(?!<[hup])(.+)$/gm, (match) => match ? `<p>${match}</p>` : match)
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<[hul])/g, '$1')
    .replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');
}

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function extractTitleFromContent(content: string): string {
  const headingMatch = content.match(/<h[123][^>]*>(.*?)<\/h[123]>/i);
  if (headingMatch) {
    return headingMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 120);
  }
  const plain = stripHtml(content).replace(/\s+/g, ' ').trim();
  const firstSentence = plain.split(/[.!?]/)[0]?.trim();
  return (firstSentence || plain).substring(0, 120);
}

interface ContentGenerationPanelProps {
  selectedTopics: TrendTopic[];
  onGenerated?: () => void;
}

export function ContentGenerationPanel({ selectedTopics, onGenerated }: ContentGenerationPanelProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);

  const campaignId = selectedTopics[0]?.campaign_id || selectedTopics[0]?.campaignId;

  const trendTitles = selectedTopics.map(t => t.title).join('\n- ');
  const systemPrompt = `Вы — профессиональный SMM-копирайтер. Ваша задача — написать пост для социальных сетей, СТРОГО выполняя инструкцию пользователя.

Тренды для вдохновения (используйте как контекст, не как главную тему, если пользователь не просит об этом):
- ${trendTitles}

ПРАВИЛА ФОРМАТИРОВАНИЯ (обязательно):
- НЕ используйте Markdown-синтаксис: никаких **, *, #, __, ~~
- Пишите обычным текстом, разделяя абзацы пустой строкой
- Эмодзи — только если они уместны по контексту
- Текст должен быть готов к прямой публикации в соцсетях
- Длина — под задачу пользователя, не раздувайте искусственно`;

  const { mutate: generateContent, isPending: isGenerating } = useMutation({
    mutationFn: async () => {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error('Требуется авторизация');
      if (!prompt.trim()) throw new Error('Введите промт для генерации');

      const genResponse = await fetch('/api/generate-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          keywords: selectedTopics.map(t => t.title),
          campaignId,
          platform: 'general',
          systemPrompt,
        })
      });

      if (!genResponse.ok) {
        const err = await genResponse.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Ошибка при генерации контента');
      }

      const genData = await genResponse.json();
      if (!genData.content) throw new Error('AI не вернул контент');
      return genData.content as string;
    },
    onSuccess: (rawContent) => {
      const isHtml = /<[a-z][\s\S]*>/i.test(rawContent);
      const html = isHtml ? rawContent : markdownToHtml(rawContent);
      setGeneratedContent(html);
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка генерации",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const { mutate: saveContent, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      if (!generatedContent) throw new Error('Нет контента для сохранения');

      const title = extractTitleFromContent(generatedContent);
      const plainContent = stripHtml(generatedContent);

      return await apiRequest('/api/campaign-content', {
        method: 'POST',
        data: {
          campaign_id: campaignId || null,
          title: title || 'Черновик из трендов',
          content: plainContent,
          content_type: 'text',
          prompt: prompt.trim(),
          status: 'draft'
        }
      });
    },
    onSuccess: () => {
      toast({
        title: "Сохранено",
        description: "Контент сохранён как черновик"
      });
      setGeneratedContent(null);
      setPrompt("");
      onGenerated?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка сохранения",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const plainText = generatedContent ? stripHtml(generatedContent) : '';

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Генерация контента на основе трендов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {selectedTopics.map(topic => (
            <span
              key={topic.id}
              className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              {topic.title.length > 50 ? topic.title.substring(0, 50) + '…' : topic.title}
            </span>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="gen-prompt">Промт</Label>
          <Textarea
            id="gen-prompt"
            data-testid="input-gen-prompt"
            placeholder="Опишите, что нужно написать. AI учтёт выбранные тренды как контекст."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="resize-none"
          />
        </div>

        <Button
          data-testid="button-generate-content"
          onClick={() => generateContent()}
          disabled={isGenerating || !prompt.trim()}
          className="w-full"
        >
          {isGenerating ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Генерация...</>
          ) : (
            <><Sparkles className="mr-2 h-4 w-4" />Сгенерировать</>
          )}
        </Button>

        {generatedContent && (
          <div className="space-y-3">
            <div
              className="rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap leading-relaxed"
              data-testid="generated-content-preview"
            >
              {plainText}
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="button-copy-content"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  navigator.clipboard.writeText(plainText);
                  toast({ title: "Скопировано", description: "Текст скопирован в буфер обмена" });
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Копировать
              </Button>
              <Button
                data-testid="button-save-content"
                onClick={() => saveContent()}
                disabled={isSaving}
                className="flex-1"
              >
                {isSaving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Сохранение...</>
                ) : (
                  <><Save className="mr-2 h-4 w-4" />Сохранить в черновики</>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
