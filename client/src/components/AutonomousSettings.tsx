import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { getConnectedPlatformsMap, CONNECTABLE_PLATFORMS, type ConnectablePlatform } from "@/lib/platform-connection";
import { extractUnconnectedMentions } from "@/lib/disconnected-mention-detector";
import { BRAND } from "@/lib/brand";
import { platformNames } from "@/lib/social-platforms";
import {
  Loader2, Save, Bot, Pencil, Users, Share2, Target, Shuffle,
  Sparkles, ChevronDown, ChevronUp, Check, Wand2, RotateCcw,
  BookOpen, Lightbulb, Eye, Settings2, BarChart3
} from "lucide-react";

/* ─────────────────────────────────────────────
   Типы
───────────────────────────────────────────── */
export interface AutonomousSettingsValue {
  globalPrompt?: string;
  alwaysInclude?: string;
  signature?: string;
  useEditorPass?: boolean;
  humanize?: boolean;
  adaptForPlatforms?: boolean;
  autoSelectPlatforms?: boolean;
  randomKeywords?: boolean;
  postsPerCycle?: number;
  intervalHours?: number;
  autoSchedule?: boolean;
  withImages?: boolean;
}

interface AssistantBuilderConfig {
  role: string;
  customRole: string;
  experience: string;
  knowledge: string[];
  skills: string[];
  tone: string;
  postLength: string;
  contentMix: { educational: number; entertaining: number; selling: number };
}

interface Props {
  campaignId: string;
  initialSettings?: AutonomousSettingsValue | string | null;
  onSettingsUpdated?: () => void;
}

/* ─────────────────────────────────────────────
   Данные конфигуратора
───────────────────────────────────────────── */
const ROLE_PRESETS = [
  "SMM-менеджер",
  "Копирайтер",
  "Контент-маркетолог",
  "PR-менеджер",
  "Маркетолог-эксперт",
  "Редактор медиа",
  "Другое...",
];

const EXPERIENCE_OPTIONS = [
  { value: "1-2 года", label: "1–2 года" },
  { value: "3-5 лет", label: "3–5 лет" },
  { value: "5-10 лет", label: "5–10 лет" },
  { value: "10+ лет", label: "10+ лет (эксперт)" },
];

const KNOWLEDGE_OPTIONS = [
  "Digital-маркетинг", "SMM", "Контент-маркетинг", "SEO", "Email-маркетинг",
  "E-commerce", "B2B продажи", "B2C продажи", "IT / SaaS", "Финансы и инвестиции",
  "Медицина и здоровье", "Образование", "Недвижимость", "Lifestyle / Красота",
  "Фитнес и спорт", "Стартапы", "Криптовалюты", "Юридическая тематика",
];

const SKILLS_OPTIONS = [
  "Сторителлинг", "Продающие тексты", "Экспертный контент", "Вирусный контент",
  "Развлекательный контент", "Образовательный контент", "Нарративы и кейсы",
  "Обзоры и сравнения", "Инфоповоды и тренды", "Провокация и дискуссии",
  "Мягкие продажи", "Активация аудитории (вопросы, опросы)",
];

const TONE_OPTIONS = [
  { value: "экспертный", label: "Экспертный — авторитетно и по делу" },
  { value: "дружелюбный", label: "Дружелюбный — тепло, как хороший знакомый" },
  { value: "провокационный", label: "Провокационный — смело, вызывает реакцию" },
  { value: "нейтральный", label: "Нейтральный — объективно, без лишних эмоций" },
  { value: "продающий", label: "Продающий — убеждает, направляет к действию" },
  { value: "развлекательный", label: "Развлекательный — легко, с юмором, живо" },
  { value: "вдохновляющий", label: "Вдохновляющий — мотивирует, заряжает энергией" },
];

const POST_LENGTH_OPTIONS = [
  { value: "короткий", label: "Короткий — до 300 символов, ёмко и чётко" },
  { value: "средний", label: "Средний — 300–700 символов, баланс" },
  { value: "длинный", label: "Длинный — 700+ символов, экспертно и глубоко" },
  { value: "смешанный", label: "Смешанный — разные форматы в ротации" },
];

const CONTENT_MIX_PRESETS = [
  { label: "Сбалансированный", educational: 34, entertaining: 33, selling: 33 },
  { label: "Обучающий", educational: 50, entertaining: 30, selling: 20 },
  { label: "Продающий", educational: 20, entertaining: 30, selling: 50 },
  { label: "Развлекательный", educational: 20, entertaining: 50, selling: 30 },
];

const DEFAULT_BUILDER: AssistantBuilderConfig = {
  role: "SMM-менеджер",
  customRole: "",
  experience: "3-5 лет",
  knowledge: [],
  skills: [],
  tone: "экспертный",
  postLength: "смешанный",
  contentMix: { educational: 34, entertaining: 33, selling: 33 },
};

/* ─────────────────────────────────────────────
   Шаблоны
───────────────────────────────────────────── */
interface PromptTemplate {
  id: string; name: string; description: string; tags: string[];
  values: Partial<AutonomousSettingsValue>;
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "smm-saas", name: "SaaS / IT-продукт", description: "Для сервисов автоматизации, CRM, маркетинговых инструментов",
    tags: ["IT", "B2B", "SaaS"],
    values: {
      globalPrompt: `Ты — опытный SMM-менеджер IT-продукта. Аудитория: маркетологи, SMM-специалисты, владельцы бизнеса (25–45 лет), которые ценят время и конкретику.

Тон: экспертный, живой, без воды. Можно использовать профессиональный сленг (ER, охват, воронка, конверсия). Абзацы по 1–3 строки.

Структура поста: зацепка (вопрос или боль клиента) → полезный контент или кейс → CTA или вопрос.

Темы для ротации: автоматизация рутины, кейсы клиентов, сравнение ручной работы vs инструмента, лайфхаки для SMM, тренды digital-маркетинга, ошибки которых стоит избегать.

Запрещено: «в современном мире», «не секрет что», «уникальный», восклицательные знаки через каждое предложение, списки из 10+ пунктов.`,
      alwaysInclude: `Попробуй сервис бесплатно: ${BRAND.appUrl} — 14 дней без карты.`,
      signature: `— Команда ${BRAND.productUrl} | ${BRAND.appUrl}`,
      useEditorPass: true, humanize: true, adaptForPlatforms: true, autoSelectPlatforms: true, randomKeywords: true,
    },
  },
  {
    id: "ecommerce", name: "Интернет-магазин / e-commerce", description: "Товарный бизнес, маркетплейсы, розничные продажи",
    tags: ["Товары", "B2C", "Продажи"],
    values: {
      globalPrompt: `Ты — SMM-менеджер интернет-магазина. Аудитория: покупатели 20–50 лет, заинтересованы в выгодных покупках и качестве.

Тон: дружелюбный, живой, с акцентом на выгоду и эмоцию. Показывай товар через историю или проблему покупателя.

Структура поста: интересный факт о товаре или ситуация из жизни → описание продукта через пользу → CTA с призывом купить или узнать больше.

Темы: обзоры товаров, лайфхаки использования, сравнения, отзывы клиентов, акции и скидки, «из жизни» истории с продуктом.

Запрещено: агрессивные призывы «КУПИ СЕЙЧАС!», слово «качественный» без доказательств, перечисление характеристик без контекста пользы.`,
      alwaysInclude: `Заказать можно на сайте: [ССЫЛКА]. Доставка по всей России, возврат 14 дней.`,
      signature: `— [Название магазина]`,
      useEditorPass: true, humanize: true, adaptForPlatforms: true, autoSelectPlatforms: false, randomKeywords: true,
    },
  },
  {
    id: "local-service", name: "Местный бизнес / услуги", description: "Кафе, салоны, клиники, агентства, офлайн-услуги",
    tags: ["Услуги", "B2C", "Офлайн"],
    values: {
      globalPrompt: `Ты — SMM-менеджер бизнеса услуг. Аудитория: местные жители, потенциальные клиенты конкретного города.

Тон: тёплый, человечный, доверительный. Показывай команду и процесс изнутри, не только результат.

Структура поста: реальная история или ситуация клиента → как мы решаем проблему → приглашение попробовать.

Темы: истории клиентов, закулисье работы, советы по теме бизнеса, мифы о нашей услуге, «до и после», акции для своих.

Запрещено: безликие стоковые описания, фраза «мы рады предложить вам», формальный язык.`,
      alwaysInclude: `Запись по телефону: [НОМЕР] или через сайт: [ССЫЛКА]. Работаем [ЧАСЫ РАБОТЫ].`,
      signature: `— Команда [Название]`,
      useEditorPass: true, humanize: true, adaptForPlatforms: false, autoSelectPlatforms: false, randomKeywords: false,
    },
  },
  {
    id: "personal-brand", name: "Личный бренд / эксперт", description: "Консультанты, коучи, фрилансеры, эксперты в нише",
    tags: ["Эксперт", "Personal brand", "Контент"],
    values: {
      globalPrompt: `Ты — контент-менеджер личного бренда эксперта. Аудитория: люди, которые интересуются темой эксперта и рассматривают его услуги.

Тон: от первого лица, личный, честный. Делись опытом, ошибками, наблюдениями. Читатель должен чувствовать, что разговаривает с живым человеком.

Структура поста: личная история или наблюдение → экспертная мысль или урок → вывод или вопрос читателю.

Темы: кейсы из практики, профессиональные ошибки и выводы, взгляд на тренды в нише, ответы на частые вопросы.

Запрещено: пустое саморекламирование без пользы, «я лучший в своей нише», сухие перечисления.`,
      alwaysInclude: `По вопросам сотрудничества: [КОНТАКТ]. Подробнее об услугах: [ССЫЛКА].`,
      signature: `— [Имя эксперта]`,
      useEditorPass: true, humanize: true, adaptForPlatforms: true, autoSelectPlatforms: false, randomKeywords: false,
    },
  },
  {
    id: "media-blog", name: "Медиа / блог / паблик", description: "Новостные каналы, тематические паблики",
    tags: ["Медиа", "Контент", "Паблик"],
    values: {
      globalPrompt: `Ты — редактор тематического медиа. Аудитория: подписчики, объединённые общим интересом к теме канала.

Тон: информативный, но не скучный. Добавляй свою точку зрения, провоцируй дискуссию. Пиши как умный друг, который следит за темой.

Структура поста: ключевой факт или новость → контекст и объяснение → мнение редакции или вопрос аудитории.

Темы: актуальные новости ниши, разбор трендов, неочевидные факты, мнения экспертов, дискуссионные вопросы.

Запрещено: кликбейт без содержания, «все говорят что», пересказ без добавленной ценности.`,
      alwaysInclude: ``,
      signature: `— Редакция [Название канала]`,
      useEditorPass: true, humanize: false, adaptForPlatforms: false, autoSelectPlatforms: false, randomKeywords: true,
    },
  },
];

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function parseSettings(raw: AutonomousSettingsValue | string | null | undefined): AutonomousSettingsValue {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw) || {}; } catch { return {}; } }
  return raw;
}

function ChipToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`chip-${label.replace(/\s+/g, '-').toLowerCase()}`}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-all select-none cursor-pointer ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {active && <Check className="h-3 w-3 mr-1" />}
      {label}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Компонент
───────────────────────────────────────────── */
export default function AutonomousSettings({ campaignId, initialSettings, onSettingsUpdated }: Props) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [values, setValues] = useState<AutonomousSettingsValue>(() => parseSettings(initialSettings));
  const [showTemplates, setShowTemplates] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);
  const [builder, setBuilder] = useState<AssistantBuilderConfig>(DEFAULT_BUILDER);
  useEffect(() => { setValues(parseSettings(initialSettings)); }, [initialSettings]);

  // SM-18 follow-up: подключённые соцсети кампании — для подсказки про
  // [socialNetworks] и для предупреждения о неподключённой сети в промте.
  //
  // Ключ ровно тот же, что у страницы кампании: секция «Подключение социальных
  // сетей» после сохранения инвалидирует его, и предупреждение обновляется само,
  // без перезагрузки (критерий 4 SM-18). Свой fetch мимо кэша этого не умел и
  // заодно уходил вторым запросом за той же кампанией.
  const { data: campaignResponse } = useQuery({
    queryKey: ["/api/proxy/campaign", campaignId],
    queryFn: () => api.campaigns.get(campaignId),
    enabled: !!campaignId,
  });

  // Держим идентификаторы платформ, а не подписи. Подпись — дело вывода: как
  // только сравнение шло по человекочитаемой строке, любая правка названия в
  // интерфейсе молча ломала проверку «подключена ли сеть».
  const connectedPlatforms: ConnectablePlatform[] = useMemo(() => {
    const campaign = (campaignResponse as any)?.data ?? campaignResponse;
    // Каноничный helper: не зависит от секретных токенов (их вырезает sanitizeOAuthSecrets).
    const map = campaign ? getConnectedPlatformsMap(campaign.social_media_settings) : null;
    if (!map) return [];
    return CONNECTABLE_PLATFORMS.filter((p) => map[p] === true);
  }, [campaignResponse]);

  const updateValue = (key: keyof AutonomousSettingsValue) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setAppliedTemplate(null);
  };

  const toggleChip = (field: "knowledge" | "skills", val: string) => {
    setBuilder((prev) => {
      const arr = prev[field];
      return { ...prev, [field]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  };

  const applyMixPreset = (preset: typeof CONTENT_MIX_PRESETS[0]) => {
    setBuilder((prev) => ({ ...prev, contentMix: { educational: preset.educational, entertaining: preset.entertaining, selling: preset.selling } }));
  };

  const handleGeneratePrompt = async () => {
    const effectiveRole = builder.role === "Другое..." ? builder.customRole.trim() : builder.role;
    if (!effectiveRole) {
      toast({ description: "Укажите роль ассистента", variant: "destructive" });
      return;
    }
    try {
      setIsGenerating(true);
      const res = await apiRequest(`/api/campaigns/${campaignId}/generate-assistant-prompt`, {
        method: "POST",
        data: {
          role: effectiveRole,
          experience: builder.experience,
          knowledge: builder.knowledge,
          skills: builder.skills,
          tone: builder.tone,
          postLength: builder.postLength,
          contentMix: builder.contentMix,
        },
      });
      const data = res as any;
      if (data?.prompt) {
        setValues((prev) => ({ ...prev, globalPrompt: data.prompt }));
        setShowBuilder(false);
        setAppliedTemplate(null);
        toast({ title: "Промт сгенерирован", description: "Проверьте результат ниже и при необходимости отредактируйте" });
      } else {
        throw new Error("Пустой ответ");
      }
    } catch (err: any) {
      toast({ title: "Ошибка генерации", description: err?.message || "Попробуйте ещё раз", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const applyTemplate = (template: PromptTemplate) => {
    setValues((prev) => ({ ...prev, ...template.values }));
    setAppliedTemplate(template.id);
    setShowTemplates(false);
    toast({ description: `Шаблон «${template.name}» применён — отредактируйте под свой бизнес и сохраните` });
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const payload: AutonomousSettingsValue = {
        globalPrompt: (values.globalPrompt || "").trim() || undefined,
        alwaysInclude: (values.alwaysInclude || "").trim() || undefined,
        signature: (values.signature || "").trim() || undefined,
        useEditorPass: values.useEditorPass ?? false,
        humanize: values.humanize ?? false,
        adaptForPlatforms: values.adaptForPlatforms ?? false,
        autoSelectPlatforms: values.autoSelectPlatforms ?? false,
        randomKeywords: values.randomKeywords ?? false,
        postsPerCycle: values.postsPerCycle ?? 5,
        intervalHours: values.intervalHours ?? 24,
        autoSchedule: values.autoSchedule ?? true,
        withImages: values.withImages ?? true,
      };
      await apiRequest(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        data: { autonomous_settings: payload },
      });
      toast({ title: "Сохранено", description: "Настройки автономного ассистента обновлены" });
      setAppliedTemplate(null);
      onSettingsUpdated?.();
    } catch (err: any) {
      toast({ title: "Ошибка сохранения", description: err?.message || "Не удалось сохранить", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const mixTotal = builder.contentMix.educational + builder.contentMix.entertaining + builder.contentMix.selling;

  return (
    <div className="space-y-5" data-testid="section-autonomous-settings">

      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <Bot className="h-5 w-5 mt-0.5 text-primary" />
        <div>
          <h3 className="text-base font-semibold">Инструкции для автономного ассистента</h3>
          <p className="text-sm text-muted-foreground">
            Настройте роль, опыт и стиль — ассистент сам сгенерирует промт, или заполните вручную.
          </p>
        </div>
      </div>

      {/* ── КОНФИГУРАТОР АССИСТЕНТА ─────────────────────────── */}
      <div className="rounded-lg border-2 border-primary/20 bg-primary/5">
        <button
          type="button"
          onClick={() => setShowBuilder((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-primary/10 transition-colors rounded-lg"
          data-testid="button-toggle-builder"
        >
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span>Конфигуратор ассистента</span>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">AI-генерация</Badge>
          </div>
          {showBuilder ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
        </button>

        {showBuilder && (
          <div className="px-4 pb-5 space-y-5 border-t border-primary/10">
            <p className="text-xs text-muted-foreground pt-3">
              Выберите параметры ассистента — кнопка «Сгенерировать промт» создаст готовый текст на основе ваших настроек.
            </p>

            {/* Роль */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Bot className="h-3.5 w-3.5 text-primary" /> Роль ассистента
                </Label>
                <Select
                  value={builder.role}
                  onValueChange={(v) => setBuilder((prev) => ({ ...prev, role: v }))}
                >
                  <SelectTrigger data-testid="select-builder-role">
                    <SelectValue placeholder="Выберите роль" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_PRESETS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                {builder.role === "Другое..." && (
                  <Input
                    data-testid="input-builder-custom-role"
                    placeholder="Введите роль вручную..."
                    value={builder.customRole}
                    onChange={(e) => setBuilder((prev) => ({ ...prev, customRole: e.target.value }))}
                  />
                )}
              </div>

              {/* Опыт */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" /> Опыт
                </Label>
                <Select
                  value={builder.experience}
                  onValueChange={(v) => setBuilder((prev) => ({ ...prev, experience: v }))}
                >
                  <SelectTrigger data-testid="select-builder-experience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPERIENCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Специализация */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <BookOpen className="h-3.5 w-3.5 text-primary" /> Специализация / знания
                <span className="text-xs text-muted-foreground font-normal ml-1">(выберите несколько)</span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {KNOWLEDGE_OPTIONS.map((k) => (
                  <ChipToggle key={k} label={k} active={builder.knowledge.includes(k)} onClick={() => toggleChip("knowledge", k)} />
                ))}
              </div>
            </div>

            {/* Навыки */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Lightbulb className="h-3.5 w-3.5 text-primary" /> Умения / стиль контента
                <span className="text-xs text-muted-foreground font-normal ml-1">(выберите несколько)</span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {SKILLS_OPTIONS.map((s) => (
                  <ChipToggle key={s} label={s} active={builder.skills.includes(s)} onClick={() => toggleChip("skills", s)} />
                ))}
              </div>
            </div>

            {/* Тон + Длина */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Settings2 className="h-3.5 w-3.5 text-primary" /> Тон общения
                </Label>
                <Select value={builder.tone} onValueChange={(v) => setBuilder((prev) => ({ ...prev, tone: v }))}>
                  <SelectTrigger data-testid="select-builder-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Pencil className="h-3.5 w-3.5 text-primary" /> Длина постов
                </Label>
                <Select value={builder.postLength} onValueChange={(v) => setBuilder((prev) => ({ ...prev, postLength: v }))}>
                  <SelectTrigger data-testid="select-builder-post-length">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POST_LENGTH_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Микс контента */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Share2 className="h-3.5 w-3.5 text-primary" /> Микс контента
              </Label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {CONTENT_MIX_PRESETS.map((p) => {
                  const isActive = builder.contentMix.educational === p.educational &&
                    builder.contentMix.entertaining === p.entertaining &&
                    builder.contentMix.selling === p.selling;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyMixPreset(p)}
                      data-testid={`mix-preset-${p.label}`}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                        isActive ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {p.label} ({p.educational}/{p.entertaining}/{p.selling})
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "educational" as const, label: "Обучающий %", color: "text-blue-500" },
                  { key: "entertaining" as const, label: "Развлекательный %", color: "text-green-500" },
                  { key: "selling" as const, label: "Продающий %", color: "text-orange-500" },
                ].map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className={`text-xs font-medium ${field.color}`}>{field.label}</label>
                    <Input
                      type="number" min={0} max={100}
                      data-testid={`input-mix-${field.key}`}
                      value={builder.contentMix[field.key]}
                      onChange={(e) => setBuilder((prev) => ({
                        ...prev,
                        contentMix: { ...prev.contentMix, [field.key]: Number(e.target.value) }
                      }))}
                      className="text-center"
                    />
                  </div>
                ))}
              </div>
              {mixTotal !== 100 && (
                <p className="text-xs text-destructive">Сумма: {mixTotal}% — должна быть 100%</p>
              )}
            </div>

            {/* Кнопка генерации */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleGeneratePrompt}
                disabled={isGenerating || mixTotal !== 100}
                className="gap-2"
                data-testid="button-generate-prompt"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {isGenerating ? "Генерирую промт..." : "Сгенерировать промт"}
              </Button>
              <button
                type="button"
                onClick={() => setBuilder(DEFAULT_BUILDER)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-reset-builder"
              >
                <RotateCcw className="h-3 w-3" /> Сбросить
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── ГОТОВЫЕ ШАБЛОНЫ ──────────────────────────────── */}
      <div className="rounded-lg border border-border bg-muted/20">
        <button
          type="button"
          onClick={() => setShowTemplates((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors rounded-lg"
          data-testid="button-toggle-templates"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Готовые шаблоны промтов
            {appliedTemplate && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Check className="h-3 w-3" /> Применён
              </Badge>
            )}
          </div>
          {showTemplates ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showTemplates && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted-foreground pb-1">
              Выберите шаблон под тип вашего бизнеса — он заполнит все поля ниже. Отредактируйте под себя и сохраните.
            </p>
            {PROMPT_TEMPLATES.map((tpl) => (
              <div
                key={tpl.id}
                className={`rounded-lg border-2 p-3 transition-all cursor-pointer hover:border-primary/50 ${
                  appliedTemplate === tpl.id ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => applyTemplate(tpl)}
                data-testid={`template-${tpl.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{tpl.name}</span>
                      {tpl.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs py-0">{tag}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>
                  </div>
                  {appliedTemplate === tpl.id
                    ? <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                    : <span className="text-xs text-primary flex-shrink-0 mt-0.5 whitespace-nowrap">Применить →</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ПРОМТ И ПОЛЯ ─────────────────────────────────── */}
      <div className="space-y-2">
        <Label htmlFor="auto-global-prompt" className="flex items-center justify-between">
          <span>Глобальный промт (тон, стиль, аудитория)</span>
          {values.globalPrompt && (
            <span className="text-xs text-muted-foreground font-normal">{values.globalPrompt.length} симв.</span>
          )}
        </Label>
        <Textarea
          id="auto-global-prompt"
          data-testid="input-auto-global-prompt"
          rows={9}
          placeholder="Сгенерируйте промт через конфигуратор выше или напишите вручную. Например: Ты — опытный SMM-менеджер IT-продукта. Аудитория: маркетологи 25–45 лет..."
          value={values.globalPrompt || ""}
          onChange={updateValue("globalPrompt")}
        />
        {/* SM-18 follow-up: живой предпросмотр подстановки [socialNetworks] */}
        {values.globalPrompt && values.globalPrompt.includes("[socialNetworks]") ? (
          <div className="rounded border border-border bg-muted/40 px-3 py-2 text-xs">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              <Eye className="h-3 w-3" /> Как это увидит модель
            </p>
            <p className="text-foreground/90 whitespace-pre-wrap">
              {values.globalPrompt.split("[socialNetworks]").join(
                connectedPlatforms.length > 0
                  ? connectedPlatforms.map((p) => platformNames[p]).join(", ")
                  : "социальных сетей кампании"
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2" title={connectedPlatforms.length > 0 ? `Подключённые соцсети: ${connectedPlatforms.map((p) => platformNames[p]).join(', ')}` : 'Соцсети не подключены'}>            <Lightbulb className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <p>
              Доступная переменная: <code className="bg-background px-1 rounded border border-border font-mono">[socialNetworks]</code> —{' '}
              заменится на подключённые соцсети автоматически.{' '}
              {connectedPlatforms.length > 0 ? (
                <span className="font-medium">Текущие: {connectedPlatforms.map((p) => platformNames[p]).join(', ')}</span>
              ) : (
                <span className="italic">Соцсети не подключены — подставится «социальных сетей кампании»</span>
              )}
            </p>
          </div>
        )}

        {/* SM-18: предупреждение о неподключённой сети, упомянутой в промте.
            Показываем только positive mentions (не в отрицающем контексте),
            и только если такая сеть реально не подключена. */}
        {(() => {
          const unconnectedMentions = values.globalPrompt
            ? extractUnconnectedMentions({
                prompt: values.globalPrompt,
                isConnected: (p) => connectedPlatforms.includes(p),
              })
            : [];
          if (unconnectedMentions.length === 0) return null;
          return (
            <div
              data-testid="warning-disconnected-platforms"
              className="rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
              role="status"
              aria-live="polite"
            >
              <p className="font-semibold flex items-center gap-1.5">
                <span aria-hidden="true">⚠</span>
                В промте упомянуты соцсети, которые не подключены у кампании
              </p>
              <p className="mt-1">
                Эти названия в промте модель воспримет буквально и попытается
                генерировать посты в них — публикация провалится с 403.
                Подключите соответствующие соцсети в настройках кампании или
                уберите упоминания из промта.
              </p>
              <p className="mt-1 font-medium" data-testid="warning-disconnected-list">
                Не подключены: {unconnectedMentions.map((p) => platformNames[p]).join(", ")}
              </p>
            </div>
          );
        })()}
      </div>

      <div className="space-y-2">
        <Label htmlFor="auto-always-include">Обязательно включать в посты (ссылка, CTA, контакты)</Label>
        <Textarea
          id="auto-always-include"
          data-testid="input-auto-always-include"
          rows={3}
          placeholder={`Например: Попробуй сервис бесплатно: ${BRAND.appUrl} — 14 дней без карты.`}
          value={values.alwaysInclude || ""}
          onChange={updateValue("alwaysInclude")}
        />
        <p className="text-xs text-muted-foreground">
          Будет органично вплетено в текст поста (а не приклеено в конец).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="auto-signature">Подпись в конце поста (дословно)</Label>
        <Textarea
          id="auto-signature"
          data-testid="input-auto-signature"
          rows={2}
          placeholder={`Например: — Команда ${BRAND.productUrl} | ${BRAND.appUrl}`}
          value={values.signature || ""}
          onChange={updateValue("signature")}
        />
      </div>

      {/* ── ПАРАМЕТРЫ ГЕНЕРАЦИИ ───────────────────────────── */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Параметры генерации</p>

        {/* Частота: интервал + постов */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Частота создания контента
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Интервал */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Запускать цикл</p>
                <p className="text-xs text-muted-foreground">Как часто AI создаёт новые посты</p>
              </div>
              <Select
                value={String(values.intervalHours ?? 24)}
                onValueChange={(v) => setValues((prev) => ({ ...prev, intervalHours: Number(v) }))}
              >
                <SelectTrigger className="w-32 shrink-0" data-testid="select-interval-hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Каждые 3 ч</SelectItem>
                  <SelectItem value="4">Каждые 4 ч</SelectItem>
                  <SelectItem value="6">Каждые 6 ч</SelectItem>
                  <SelectItem value="8">Каждые 8 ч</SelectItem>
                  <SelectItem value="12">Каждые 12 ч</SelectItem>
                  <SelectItem value="24">Раз в сутки</SelectItem>
                  <SelectItem value="48">Раз в 2 дня</SelectItem>
                  <SelectItem value="72">Раз в 3 дня</SelectItem>
                  <SelectItem value="168">Раз в неделю</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Постов в цикле */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Постов за цикл</p>
                <p className="text-xs text-muted-foreground">Сколько постов за один запуск</p>
              </div>
              <Select
                value={String(values.postsPerCycle ?? 5)}
                onValueChange={(v) => setValues((prev) => ({ ...prev, postsPerCycle: Number(v) }))}
              >
                <SelectTrigger className="w-28 shrink-0" data-testid="select-posts-per-cycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 7, 10, 14, 21].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "пост" : n < 5 ? "поста" : "постов"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Пояснение итоговой частоты */}
          {(() => {
            const interval = values.intervalHours ?? 24;
            const posts = values.postsPerCycle ?? 5;
            const perDay = (24 / interval) * posts;
            const perWeek = Math.round(perDay * 7);
            return (
              <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                При текущих настройках: <strong>{perDay % 1 === 0 ? perDay : perDay.toFixed(1)} постов/день</strong> — {perWeek} в неделю
              </p>
            );
          })()}
        </div>

        <div className="border-t border-border/60 pt-3 space-y-3">
          {[
            {
              id: "with-images", key: "withImages" as const,
              icon: <Sparkles className="h-3.5 w-3.5 text-primary" />,
              label: "Генерировать изображения к постам",
              desc: "AI создаёт картинку для каждого поста через Flux/DALL-E. Замедляет цикл, но повышает охват.",
            },
            {
              id: "auto-schedule", key: "autoSchedule" as const,
              icon: <Target className="h-3.5 w-3.5 text-primary" />,
              label: "Автоматически планировать публикацию",
              desc: "Готовые посты сразу отправляются в расписание. Если выключено — остаются черновиками для проверки.",
            },
            {
              id: "use-editor-pass", key: "useEditorPass" as const,
              icon: <Pencil className="h-3.5 w-3.5 text-primary" />,
              label: "Включить AI-редактора",
              desc: "После генерации AI дополнительно редактирует каждый пост: структура, тон, зацепка.",
            },
            {
              id: "humanize-text", key: "humanize" as const,
              icon: <Users className="h-3.5 w-3.5 text-primary" />,
              label: "Очеловечить текст",
              desc: "AI пишет как живой эксперт: неровный ритм, личные наблюдения, разговорные обороты.",
            },
            {
              id: "adapt-for-platforms", key: "adaptForPlatforms" as const,
              icon: <Share2 className="h-3.5 w-3.5 text-primary" />,
              label: "Адаптировать под каждую соцсеть",
              desc: "Отдельная версия для Telegram, VK, Instagram, Facebook — каждая со своим тоном и хэштегами.",
            },
            {
              id: "auto-select-platforms", key: "autoSelectPlatforms" as const,
              icon: <Target className="h-3.5 w-3.5 text-primary" />,
              label: "AI выбирает соцсети для каждого поста",
              desc: "Ассистент сам решает в какие соцсети публиковать исходя из типа и тона контента.",
            },
            {
              id: "random-keywords", key: "randomKeywords" as const,
              icon: <Shuffle className="h-3.5 w-3.5 text-primary" />,
              label: "Случайные ключевые слова",
              desc: "Каждый цикл берёт случайную выборку из ключевых слов — больше разнообразия тематики.",
            },
          ].map((opt) => (
            <div key={opt.id} className="flex items-start gap-3">
              <Checkbox
                id={opt.id}
                data-testid={`checkbox-${opt.id}`}
                checked={(values[opt.key] as boolean) ?? false}
                onCheckedChange={(checked) => setValues((prev) => ({ ...prev, [opt.key]: checked === true }))}
                className="mt-0.5"
              />
              <div>
                <label htmlFor={opt.id} className="flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none">
                  {opt.icon} {opt.label}
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-auto-settings">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Сохранить настройки
        </Button>
      </div>
    </div>
  );
}
