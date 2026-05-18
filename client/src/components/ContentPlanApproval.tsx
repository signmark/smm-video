import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  XCircle,
  Edit3,
  Trash2,
  ClipboardList,
  AlertTriangle,
} from "lucide-react";

interface ContentPlanItem {
  id: string;
  topic: string;
  contentType: string;
  platform: string;
  rationale: string;
  approved?: boolean;
}

interface ContentPlanApprovalProps {
  campaignId: string;
  plan: ContentPlanItem[];
  approvalStep: string | null;
  onClose?: () => void;
}

const CONTENT_TYPE_COLORS: Record<string, string> = {
  обучающий: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  кейс: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  вовлекающий: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  экспертный: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  провокация: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  анонс: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  мотивационный: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

export function ContentPlanApproval({
  campaignId,
  plan,
  approvalStep,
  onClose,
}: ContentPlanApprovalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<ContentPlanItem[]>(
    plan.map((item) => ({ ...item, approved: item.approved !== false }))
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState("");

  const token = localStorage.getItem("auth_token");

  const { mutate: approvePlan, isPending: isApproving } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/autonomous/approve-plan/${campaignId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Ошибка одобрения");
      return res.json();
    },
    onSuccess: () => {
      toast({ description: "✅ Контент-план одобрен — запускаем написание постов" });
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/status", campaignId] });
      onClose?.();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", description: err.message });
    },
  });

  const { mutate: rejectPlan, isPending: isRejecting } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/autonomous/reject-plan/${campaignId}`, {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) throw new Error("Ошибка отклонения");
      return res.json();
    },
    onSuccess: () => {
      toast({ description: "❌ Контент-план отклонён" });
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/status", campaignId] });
      onClose?.();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", description: err.message });
    },
  });

  const toggleItem = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, approved: !item.approved } : item
      )
    );
  };

  const startEdit = (item: ContentPlanItem) => {
    setEditingId(item.id);
    setEditTopic(item.topic);
  };

  const saveEdit = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, topic: editTopic } : item
      )
    );
    setEditingId(null);
  };

  const deleteItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const approvedCount = items.filter((i) => i.approved !== false).length;

  const stepLabel =
    approvalStep === "plan"
      ? "Контент-план готов"
      : approvalStep === "content"
      ? "Тексты готовы"
      : "Картинки готовы";

  return (
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="text-sm text-amber-800 dark:text-amber-300">
          <span className="font-medium">{stepLabel}.</span> Проверьте идеи, при необходимости отредактируйте или снимите галочку, затем одобрите.
        </div>
      </div>

      {/* Список идей */}
      <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
        {items.map((item, idx) => (
          <div
            key={item.id}
            data-testid={`plan-item-${item.id}`}
            className={`rounded-lg border p-3 transition-opacity ${
              item.approved === false
                ? "opacity-40 border-dashed"
                : "border-solid"
            } bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700`}
          >
            <div className="flex items-start gap-2">
              {/* Номер + чекбокс */}
              <button
                data-testid={`toggle-item-${item.id}`}
                onClick={() => toggleItem(item.id)}
                className="mt-0.5 shrink-0"
              >
                {item.approved === false ? (
                  <XCircle className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                )}
              </button>

              {/* Содержимое */}
              <div className="flex-1 min-w-0">
                {editingId === item.id ? (
                  <div className="space-y-1">
                    <Textarea
                      value={editTopic}
                      onChange={(e) => setEditTopic(e.target.value)}
                      rows={2}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="default" onClick={() => saveEdit(item.id)}>
                        Сохранить
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-900 dark:text-gray-100 leading-snug">
                    <span className="text-gray-400 dark:text-gray-500 mr-1">{idx + 1}.</span>
                    {item.topic}
                  </p>
                )}

                <div className="flex flex-wrap gap-1 mt-1.5">
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 py-0 ${
                      CONTENT_TYPE_COLORS[item.contentType] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {item.contentType}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {item.platform}
                  </Badge>
                </div>

                {item.rationale && editingId !== item.id && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 line-clamp-1">
                    {item.rationale}
                  </p>
                )}
              </div>

              {/* Кнопки действий */}
              {editingId !== item.id && (
                <div className="flex gap-1 shrink-0">
                  <button
                    data-testid={`edit-item-${item.id}`}
                    onClick={() => startEdit(item)}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    data-testid={`delete-item-${item.id}`}
                    onClick={() => deleteItem(item.id)}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Итог + кнопки */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Выбрано: <span className="font-medium text-gray-900 dark:text-gray-100">{approvedCount}</span> из {items.length}
        </span>
        <div className="flex gap-2">
          <Button
            data-testid="reject-plan-btn"
            variant="outline"
            size="sm"
            onClick={() => rejectPlan()}
            disabled={isRejecting || isApproving}
          >
            {isRejecting ? "..." : "Отклонить"}
          </Button>
          <Button
            data-testid="approve-plan-btn"
            size="sm"
            onClick={() => approvePlan()}
            disabled={isApproving || isRejecting || approvedCount === 0}
          >
            {isApproving ? "Запускаем..." : `Одобрить (${approvedCount})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ContentPlanDialogProps {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: ContentPlanItem[] | null;
  approvalStep: string | null;
  pendingContentIds?: string[] | null;
}

function ContentStepApproval({
  campaignId,
  approvalStep,
  pendingContentIds,
  onClose,
}: {
  campaignId: string;
  approvalStep: 'content' | 'images';
  pendingContentIds?: string[] | null;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token");

  const { mutate: approve, isPending: isApproving } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/autonomous/approve-plan/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ items: [] }),
      });
      if (!res.ok) throw new Error("Ошибка одобрения");
      return res.json();
    },
    onSuccess: () => {
      const msg = approvalStep === 'content'
        ? "✅ Тексты одобрены — генерируем картинки"
        : "✅ Картинки одобрены — планируем публикации";
      toast({ description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/status", campaignId] });
      onClose?.();
    },
  });

  const { mutate: reject, isPending: isRejecting } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/autonomous/reject-plan/${campaignId}`, {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) throw new Error("Ошибка отклонения");
      return res.json();
    },
    onSuccess: () => {
      toast({ description: "❌ Цикл остановлен" });
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/status", campaignId] });
      onClose?.();
    },
  });

  const isContent = approvalStep === 'content';

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2 p-3 rounded-lg border ${
        isContent
          ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700"
          : "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700"
      }`}>
        <AlertTriangle className={`h-4 w-4 shrink-0 ${isContent ? "text-blue-600 dark:text-blue-400" : "text-purple-600 dark:text-purple-400"}`} />
        <div className={`text-sm ${isContent ? "text-blue-800 dark:text-blue-300" : "text-purple-800 dark:text-purple-300"}`}>
          <span className="font-medium">{isContent ? "Тексты написаны." : "Картинки сгенерированы."}</span>{" "}
          {isContent
            ? "Посты сохранены как черновики. Проверьте их в разделе «Контент» и нажмите Одобрить, чтобы перейти к генерации картинок."
            : "Картинки прикреплены к постам. Проверьте их в разделе «Контент» и нажмите Одобрить, чтобы запланировать публикации."}
        </div>
      </div>

      {pendingContentIds && pendingContentIds.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Созданные посты ({pendingContentIds.length}):</p>
          <div className="space-y-1">
            {pendingContentIds.map((id, i) => (
              <div key={id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span className="font-mono truncate">{id.slice(0, 8)}...</span>
                <a
                  href={`/content?highlight=${id}`}
                  className="ml-auto text-blue-500 hover:underline shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  Открыть
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <Button
          data-testid="reject-step-btn"
          variant="outline"
          size="sm"
          onClick={() => reject()}
          disabled={isRejecting || isApproving}
        >
          {isRejecting ? "..." : "Остановить цикл"}
        </Button>
        <Button
          data-testid="approve-step-btn"
          size="sm"
          onClick={() => approve()}
          disabled={isApproving || isRejecting}
        >
          {isApproving ? "Запускаем..." : isContent ? "Одобрить → Генерировать картинки" : "Одобрить → Запланировать"}
        </Button>
      </div>
    </div>
  );
}

export function ContentPlanDialog({
  campaignId,
  open,
  onOpenChange,
  plan,
  approvalStep,
  pendingContentIds,
}: ContentPlanDialogProps) {
  const dialogTitles: Record<string, string> = {
    plan: "Контент-план ожидает одобрения",
    content: "Тексты написаны — проверьте",
    images: "Картинки готовы — проверьте",
  };
  const dialogDescs: Record<string, string> = {
    plan: "AI составил план публикаций на основе трендов и аналитики",
    content: "Посты сохранены как черновики. Одобрите чтобы перейти к генерации картинок.",
    images: "Картинки прикреплены к постам. Одобрите чтобы запланировать публикации.",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-blue-500" />
            {dialogTitles[approvalStep || 'plan'] ?? "Ожидает одобрения"}
          </DialogTitle>
          <DialogDescription>
            {dialogDescs[approvalStep || 'plan'] ?? ""}
          </DialogDescription>
        </DialogHeader>

        {(approvalStep === 'content' || approvalStep === 'images') ? (
          <ContentStepApproval
            campaignId={campaignId}
            approvalStep={approvalStep}
            pendingContentIds={pendingContentIds}
            onClose={() => onOpenChange(false)}
          />
        ) : plan && plan.length > 0 ? (
          <div className="flex-1 overflow-hidden">
            <ContentPlanApproval
              campaignId={campaignId}
              plan={plan}
              approvalStep={approvalStep}
              onClose={() => onOpenChange(false)}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-4 text-center">
            Данные плана не получены
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
