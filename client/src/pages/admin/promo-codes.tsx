import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { apiRequest } from '@/lib/queryClient';
import {
  Plus, Trash2, Pencil, ToggleLeft, ToggleRight, Copy, Eye,
  Percent, CalendarDays, Zap, Users, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react';
import { formatDateWithTimezone } from '@/lib/date-utils';

type PromoType = 'discount' | 'extra_days' | 'pro_upgrade';

interface PromoCode {
  id: string;
  code: string;
  type: PromoType;
  value: number;
  description: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  date_created: string;
}

interface PromoUse {
  id: string;
  user_id: string;
  used_at: string;
  plan_before: string | null;
}

const TYPE_CONFIG: Record<PromoType, { label: string; icon: React.ReactNode; color: string; unit: string }> = {
  discount: {
    label: 'Скидка',
    icon: <Percent className="h-3.5 w-3.5" />,
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    unit: '%',
  },
  extra_days: {
    label: 'Доп. дни',
    icon: <CalendarDays className="h-3.5 w-3.5" />,
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    unit: 'дн.',
  },
  pro_upgrade: {
    label: 'Pro-апгрейд',
    icon: <Zap className="h-3.5 w-3.5" />,
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    unit: 'дн.',
  },
};

const emptyForm = {
  code: '',
  type: 'extra_days' as PromoType,
  value: '30',
  description: '',
  max_uses: '',
  is_active: true,
  expires_at: '',
};

function formatDate(date: string | null) {
  if (!date) return '—';
  try {
    return formatDateWithTimezone(date, 'd MMM yyyy');
  } catch {
    return date;
  }
}

function UsesDialog({ promoId, code, onClose }: { promoId: string; code: string; onClose: () => void }) {
  const token = useAuthStore((s) => s.token);

  const { data, isLoading } = useQuery<{ success: boolean; data: PromoUse[] }>({
    queryKey: ['/api/admin/promo-codes', promoId, 'uses'],
    queryFn: () => apiRequest(`/api/admin/promo-codes/${promoId}/uses`),
    enabled: !!token,
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Использования кода <span className="font-mono text-primary">{code}</span></DialogTitle>
          <DialogDescription>История применения промокода пользователями</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.data?.length ? (
          <p className="text-center text-muted-foreground py-8 text-sm">Промокод ещё не использовался</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Тариф до</TableHead>
                  <TableHead>Дата</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((use) => (
                  <TableRow key={use.id}>
                    <TableCell className="font-mono text-xs">{use.user_id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-xs">{use.plan_before || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(use.used_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodeFormDialog({
  initial,
  onClose,
  onSave,
  isSaving,
}: {
  initial?: PromoCode | null;
  onClose: () => void;
  onSave: (data: typeof emptyForm) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState(
    initial
      ? {
          code: initial.code,
          type: initial.type,
          value: String(initial.value),
          description: initial.description || '',
          max_uses: initial.max_uses !== null ? String(initial.max_uses) : '',
          is_active: initial.is_active,
          expires_at: initial.expires_at
            ? initial.expires_at.slice(0, 10)
            : '',
        }
      : emptyForm
  );

  const set = (key: keyof typeof emptyForm, val: any) => setForm((p) => ({ ...p, [key]: val }));

  const typeConf = TYPE_CONFIG[form.type];

  const valuePlaceholder =
    form.type === 'discount' ? 'Процент скидки (1–100)' :
    form.type === 'extra_days' ? 'Количество дней' :
    'Дней Pro-доступа';

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Редактировать промокод' : 'Создать промокод'}</DialogTitle>
          <DialogDescription>Заполните параметры промокода</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Код</Label>
            <Input
              data-testid="input-promo-code"
              placeholder="SUMMER30"
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              disabled={!!initial}
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Тип</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v as PromoType)}>
              <SelectTrigger data-testid="select-promo-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discount">
                  <span className="flex items-center gap-2"><Percent className="h-4 w-4 text-green-600" /> Скидка на оплату</span>
                </SelectItem>
                <SelectItem value="extra_days">
                  <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" /> Дополнительные дни</span>
                </SelectItem>
                <SelectItem value="pro_upgrade">
                  <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-purple-600" /> Апгрейд до Pro</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Значение ({typeConf.unit})</Label>
            <Input
              data-testid="input-promo-value"
              type="number"
              min={1}
              max={form.type === 'discount' ? 100 : undefined}
              placeholder={valuePlaceholder}
              value={form.value}
              onChange={(e) => set('value', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Описание (необязательно)</Label>
            <Input
              data-testid="input-promo-description"
              placeholder="Промокод для партнёров"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Лимит использований</Label>
              <Input
                data-testid="input-promo-max-uses"
                type="number"
                min={1}
                placeholder="Без лимита"
                value={form.max_uses}
                onChange={(e) => set('max_uses', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Действует до</Label>
              <Input
                data-testid="input-promo-expires"
                type="date"
                value={form.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              data-testid="switch-promo-active"
              checked={form.is_active}
              onCheckedChange={(v) => set('is_active', v)}
            />
            <Label>{form.is_active ? 'Активен' : 'Неактивен'}</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            data-testid="button-save-promo"
            onClick={() => onSave(form)}
            disabled={isSaving || !form.code || !form.value}
          >
            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            {initial ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PromoCodesPage() {
  const token = useAuthStore((s) => s.token);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<PromoCode | null>(null);
  const [viewingUsesId, setViewingUsesId] = useState<{ id: string; code: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery<{ success: boolean; data: PromoCode[] }>({
    queryKey: ['/api/admin/promo-codes'],
    queryFn: () => apiRequest('/api/admin/promo-codes'),
    enabled: !!token,
    retry: 1,
    staleTime: 0,
    refetchOnMount: true,
  });

  const codes = data?.data || [];

  const createMutation = useMutation({
    mutationFn: (body: Record<string, any>) =>
      apiRequest('/api/admin/promo-codes', { method: 'POST', data: body }),
    onSuccess: () => {
      toast({ title: 'Промокод создан' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/promo-codes'] });
      setShowForm(false);
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Ошибка', description: err.message || 'Не удалось создать промокод' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, any> }) =>
      apiRequest(`/api/admin/promo-codes/${id}`, { method: 'PATCH', data: body }),
    onSuccess: () => {
      toast({ title: 'Промокод обновлён' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/promo-codes'] });
      setEditingCode(null);
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Ошибка', description: err.message || 'Не удалось обновить промокод' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/admin/promo-codes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({ title: 'Промокод удалён' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/promo-codes'] });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Ошибка', description: err.message });
    },
  });

  const handleSave = (form: typeof emptyForm) => {
    const body: Record<string, any> = {
      code: form.code,
      type: form.type,
      value: Number(form.value),
      description: form.description || null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      is_active: form.is_active,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };

    if (editingCode) {
      updateMutation.mutate({ id: editingCode.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const handleToggleActive = (code: PromoCode) => {
    updateMutation.mutate({ id: code.id, body: { is_active: !code.is_active } });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: 'Код скопирован', description: code });
  };

  const handleDelete = (code: PromoCode) => {
    if (!confirm(`Удалить промокод ${code.code}? Действие необратимо.`)) return;
    deleteMutation.mutate(code.id);
  };

  const stats = {
    total: codes.length,
    active: codes.filter((c) => c.is_active).length,
    totalUses: codes.reduce((sum, c) => sum + (c.used_count || 0), 0),
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-6xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Промокоды</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Управление скидками и бонусами для пользователей</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" data-testid="button-refresh-promos" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Обновить
          </Button>
          <Button data-testid="button-create-promo" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Создать код
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Всего кодов</p>
            <p className="text-2xl font-bold" data-testid="stat-total-promos">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Активных</p>
            <p className="text-2xl font-bold text-green-600" data-testid="stat-active-promos">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Использований</p>
            <p className="text-2xl font-bold" data-testid="stat-total-uses">{stats.totalUses}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Список промокодов</CardTitle>
          <CardDescription>Нажмите на код, чтобы скопировать его</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-muted-foreground">
              <Percent className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm text-destructive">Ошибка загрузки промокодов</p>
              <p className="text-xs mt-1 text-destructive/70">{(error as any)?.message || String(error)}</p>
              <button className="mt-3 text-xs underline" onClick={() => refetch()}>Повторить</button>
            </div>
          ) : codes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Percent className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Промокодов ещё нет</p>
              <p className="text-xs mt-1">Нажмите «Создать код», чтобы добавить первый</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32 py-2">Код</TableHead>
                    <TableHead className="py-2">Тип</TableHead>
                    <TableHead className="py-2 w-20">Знач.</TableHead>
                    <TableHead className="py-2 text-center w-24">Исп-й</TableHead>
                    <TableHead className="py-2 w-24">Истекает</TableHead>
                    <TableHead className="py-2 text-center w-24">Статус</TableHead>
                    <TableHead className="py-2 text-right w-24">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((code) => {
                    const typeConf = TYPE_CONFIG[code.type];
                    const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
                    const isFull = code.max_uses !== null && code.used_count >= code.max_uses;

                    return (
                      <TableRow key={code.id} data-testid={`row-promo-${code.id}`}>
                        <TableCell className="py-2">
                          <button
                            data-testid={`button-copy-code-${code.id}`}
                            className="font-mono font-semibold text-sm flex items-center gap-1 hover:text-primary transition-colors"
                            onClick={() => handleCopyCode(code.code)}
                            title={code.description || code.code}
                          >
                            {code.code}
                            <Copy className="h-3 w-3 opacity-50" />
                          </button>
                        </TableCell>
                        <TableCell className="py-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${typeConf.color}`}>
                            {typeConf.icon}
                            {typeConf.label}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 font-medium text-sm">
                          {code.value}{typeConf.unit}
                        </TableCell>
                        <TableCell className="py-2 text-center">
                          <button
                            data-testid={`button-view-uses-${code.id}`}
                            className="inline-flex items-center gap-1 text-sm hover:text-primary transition-colors"
                            onClick={() => setViewingUsesId({ id: code.id, code: code.code })}
                          >
                            <Users className="h-3.5 w-3.5" />
                            {code.used_count || 0}
                            {code.max_uses !== null && <span className="text-muted-foreground">/{code.max_uses}</span>}
                          </button>
                        </TableCell>
                        <TableCell className={`py-2 text-xs ${isExpired ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {formatDate(code.expires_at)}
                        </TableCell>
                        <TableCell className="py-2 text-center">
                          {isFull ? (
                            <Badge variant="secondary" className="text-xs">Исчерпан</Badge>
                          ) : isExpired ? (
                            <Badge variant="destructive" className="text-xs">Истёк</Badge>
                          ) : code.is_active ? (
                            <Badge className="text-xs bg-green-600 hover:bg-green-700">Активен</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Выкл.</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <div className="flex justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              data-testid={`button-toggle-promo-${code.id}`}
                              onClick={() => handleToggleActive(code)}
                              title={code.is_active ? 'Деактивировать' : 'Активировать'}
                            >
                              {code.is_active
                                ? <ToggleRight className="h-3.5 w-3.5 text-green-600" />
                                : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              data-testid={`button-edit-promo-${code.id}`}
                              onClick={() => setEditingCode(code)}
                              title="Редактировать"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              data-testid={`button-delete-promo-${code.id}`}
                              onClick={() => handleDelete(code)}
                              title="Удалить"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Справка по типам промокодов</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="flex gap-3">
              <span className="text-green-600 mt-0.5"><Percent className="h-4 w-4" /></span>
              <div>
                <p className="font-medium">Скидка на оплату</p>
                <p className="text-muted-foreground text-xs mt-0.5">Уменьшает сумму платежа при оплате тарифа. Применяется на странице оплаты.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-blue-600 mt-0.5"><CalendarDays className="h-4 w-4" /></span>
              <div>
                <p className="font-medium">Дополнительные дни</p>
                <p className="text-muted-foreground text-xs mt-0.5">Продлевает текущую подписку на указанное количество дней. Применяется сразу.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-purple-600 mt-0.5"><Zap className="h-4 w-4" /></span>
              <div>
                <p className="font-medium">Апгрейд до Pro</p>
                <p className="text-muted-foreground text-xs mt-0.5">Временно переводит пользователя на тариф Pro. Применяется сразу.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {(showForm || editingCode) && (
        <CodeFormDialog
          initial={editingCode}
          onClose={() => { setShowForm(false); setEditingCode(null); }}
          onSave={handleSave}
          isSaving={isSaving}
        />
      )}

      {viewingUsesId && (
        <UsesDialog
          promoId={viewingUsesId.id}
          code={viewingUsesId.code}
          onClose={() => setViewingUsesId(null)}
        />
      )}
    </div>
  );
}
