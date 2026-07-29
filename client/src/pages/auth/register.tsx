import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/store";
import {
  Loader2, ArrowLeft, ArrowRight, CheckCircle2,
  User, Briefcase, Rocket, Share2, Check
} from "lucide-react";

const JOB_TITLES = [
  "SMM-специалист",
  "Маркетолог",
  "Контент-менеджер",
  "Владелец бизнеса",
  "Другое",
] as const;

const SOCIAL_NETWORKS = [
  { id: "telegram", name: "Telegram", icon: "fab fa-telegram", color: "#0088cc", hint: "Токен бота и Chat ID" },
  { id: "vk", name: "ВКонтакте", icon: "fab fa-vk", color: "#4c75a3", hint: "Токен группы" },
  { id: "instagram", name: "Instagram", icon: "fab fa-instagram", color: "#e1306c", hint: "Meta Business" },
  { id: "facebook", name: "Facebook", icon: "fab fa-facebook", color: "#1877f2", hint: "Страница Facebook" },
  { id: "youtube", name: "YouTube", icon: "fab fa-youtube", color: "#ff0000", hint: "OAuth-подключение" },
] as const;

const registerSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно"),
  lastName: z.string().min(1, "Фамилия обязательна"),
  email: z.string().email("Неверный формат email"),
  password: z.string().min(6, "Минимум 6 символов"),
  confirmPassword: z.string().min(6, "Подтвердите пароль"),
  jobTitle: z.string().min(1, "Укажите вашу должность"),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "Необходимо принять условия оферты" }) }),
  privacyAccepted: z.literal(true, { errorMap: () => ({ message: "Необходимо принять политику конфиденциальности" }) }),
  personalDataAccepted: z.literal(true, { errorMap: () => ({ message: "Необходимо дать согласие на обработку данных" }) }),
  marketingConsent: z.boolean(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

const campaignSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
  autoAnalyzeWebsite: z.boolean().default(false),
  autoFillQuestionnaire: z.boolean().default(false),
  autoGenerateKeywords: z.boolean().default(false),
});

type RegisterValues = z.infer<typeof registerSchema>;
type CampaignValues = z.infer<typeof campaignSchema>;

const STEPS = [
  { id: 1, label: "Аккаунт", icon: User },
  { id: 2, label: "Кампания", icon: Briefcase },
  { id: 3, label: "Соцсети", icon: Share2 },
];

export default function Register() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [partnerCode, setPartnerCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ref.trim()) {
      const code = ref.trim().toUpperCase();
      setPartnerCode(code);
      localStorage.setItem("smm_partner_code", code);
    } else {
      const stored = localStorage.getItem("smm_partner_code");
      if (stored) setPartnerCode(stored);
    }
  }, []);

  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignCreating, setCampaignCreating] = useState(false);
  const [campaignProgress, setCampaignProgress] = useState<string[]>([]);
  const [completedNetworks] = useState<Set<string>>(new Set());

  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    // Галочки согласий в схеме объявлены как z.literal(true): форма считается
    // валидной только когда они проставлены. Стартовое значение при этом
    // обязано быть false — иначе чекбоксы отрисуются уже отмеченными. Тип
    // defaultValues в react-hook-form требует ровно `true`, поэтому здесь
    // единственное место, где приведение оправдано: расхождение чисто
    // типовое, поведение формы правильное.
    defaultValues: {
      firstName: "", lastName: "", email: "", password: "", confirmPassword: "",
      jobTitle: "", termsAccepted: false, privacyAccepted: false,
      personalDataAccepted: false, marketingConsent: false,
    } as unknown as RegisterValues,
  });

  const campaignForm = useForm<CampaignValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: "", description: "", websiteUrl: "",
      autoAnalyzeWebsite: false, autoFillQuestionnaire: false, autoGenerateKeywords: false,
    },
  });

  const onRegisterSubmit = async (values: RegisterValues) => {
    try {
      const { getFullApiUrl } = await import("@/lib/api-config");
      const apiUrl = getFullApiUrl("REGISTER");

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          firstName: values.firstName,
          lastName: values.lastName,
          jobTitle: values.jobTitle,
          ...(partnerCode ? { partnerCode } : {}),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Ошибка при регистрации");
      }

      const result = await response.json();
      setUserId(result.userId);

      // Код использован — удаляем чтобы не прилип к следующему пользователю
      localStorage.removeItem("smm_partner_code");

      if (result.token && result.userId) {
        setAuthToken(result.token);
        setAuth(result.token, result.userId);
        if (result.refresh_token) {
          localStorage.setItem("refresh_token", result.refresh_token);
        }
        localStorage.setItem("smm_new_user", "true");
        setStep(2);
      } else {
        toast({ title: "Аккаунт создан!", description: "Войдите, чтобы продолжить настройку." });
        navigate("/auth/login");
      }
    } catch (error) {
      toast({
        title: "Ошибка регистрации",
        description: error instanceof Error ? error.message : "Проверьте введённые данные",
        variant: "destructive",
      });
    }
  };

  const addProgress = (msg: string) => setCampaignProgress((p) => [...p, msg]);

  const onCampaignSubmit = async (values: CampaignValues) => {
    if (!authToken || !userId) return;
    setCampaignCreating(true);
    setCampaignProgress([]);

    try {
      addProgress("Создание кампании...");
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description?.trim() || null,
          link: values.websiteUrl?.trim() || null,
          userId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось создать кампанию");
      const created = await res.json();
      const cId = created.data.id;
      setCampaignId(cId);
      addProgress("✓ Кампания создана");

      if (values.websiteUrl && values.autoAnalyzeWebsite) {
        addProgress("Анализирую сайт...");
        try {
          const aRes = await fetch("/api/analyze-site", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ url: values.websiteUrl, campaignId: cId }),
          });
          if (aRes.ok) {
            const aData = await aRes.json();
            addProgress("✓ Сайт проанализирован");
            if (values.autoFillQuestionnaire && aData.data) {
              addProgress("Заполняю анкету...");
              try {
                await fetch(`/api/campaigns/${cId}/questionnaire`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                  body: JSON.stringify(aData.data),
                });
                addProgress("✓ Анкета заполнена");
              } catch { addProgress("⚠ Анкету не удалось заполнить"); }
            }
          } else { addProgress("⚠ Анализ сайта не удался"); }
        } catch { addProgress("⚠ Ошибка анализа сайта"); }
      }

      if (values.websiteUrl && values.autoGenerateKeywords) {
        addProgress("Подбираю ключевые слова...");
        try {
          const kRes = await fetch(`/api/campaigns/${cId}/keywords`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ url: values.websiteUrl, campaignId: cId }),
          });
          addProgress(kRes.ok ? "✓ Ключевые слова подобраны" : "⚠ Ключевые слова не удалось подобрать");
        } catch { addProgress("⚠ Ошибка подбора ключевых слов"); }
      }

      setTimeout(() => {
        setCampaignCreating(false);
        setStep(3);
      }, 1000);
    } catch (error) {
      setCampaignCreating(false);
      toast({
        title: "Ошибка создания кампании",
        description: error instanceof Error ? error.message : "Попробуйте ещё раз",
        variant: "destructive",
      });
    }
  };

  const finishOnboarding = () => {
    if (campaignId) {
      navigate(`/campaigns/${campaignId}`);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <i className="fas fa-robot text-indigo-600 text-2xl" />
            <span className="text-xl font-bold text-gray-900">SMM Manager</span>
          </div>
          <p className="text-sm text-gray-500">Настройка займёт менее 2 минут</p>
        </div>

        <div className="flex items-center justify-between mb-8 relative">
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-200 -z-0" />
          <div
            className="absolute top-5 left-0 h-0.5 bg-indigo-500 transition-all duration-500 -z-0"
            style={{ width: step === 1 ? "0%" : step === 2 ? "50%" : "100%" }}
          />
          {STEPS.map((s) => {
            const Icon = s.icon;
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex flex-col items-center gap-1 z-10">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    done
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : active
                      ? "bg-white border-indigo-600 text-indigo-600"
                      : "bg-white border-gray-300 text-gray-400"
                  }`}
                >
                  {done ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span className={`text-xs font-medium ${active ? "text-indigo-600" : done ? "text-indigo-600" : "text-gray-400"}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {step === 1 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Создайте аккаунт</h2>
              <p className="text-sm text-gray-500 mb-6">Шаг 1 из 3 — ваши данные</p>
              <Form {...registerForm}>
                <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4" noValidate>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={registerForm.control} name="firstName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Имя</FormLabel>
                        <FormControl><Input placeholder="Иван" data-testid="input-first-name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={registerForm.control} name="lastName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Фамилия</FormLabel>
                        <FormControl><Input placeholder="Иванов" data-testid="input-last-name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={registerForm.control} name="jobTitle" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ваша должность</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-job-title">
                            <SelectValue placeholder="Выберите должность" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {JOB_TITLES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={registerForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" placeholder="ivan@example.com" data-testid="input-email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={registerForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Пароль</FormLabel>
                        <FormControl><Input type="password" placeholder="Минимум 6 символов" data-testid="input-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={registerForm.control} name="confirmPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Подтвердить</FormLabel>
                        <FormControl><Input type="password" placeholder="Повторите пароль" data-testid="input-confirm-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="space-y-3 pt-1 text-sm text-gray-700 border-t border-gray-100 mt-2">
                    {[
                      { name: "termsAccepted" as const, label: "Я принимаю условия оферты.", link: "/smmniap_static/terms.html", linkLabel: "Публичная оферта" },
                      { name: "privacyAccepted" as const, label: "Ознакомлен(а) с политикой конфиденциальности.", link: "/smmniap_static/privacy.html", linkLabel: "Политика" },
                      { name: "personalDataAccepted" as const, label: "Даю согласие на обработку персональных данных.", link: "/smmniap_static/privacy.html", linkLabel: "Подробнее" },
                    ].map(({ name, label, link, linkLabel }) => (
                      <FormField key={name} control={registerForm.control} name={name} render={({ field }) => (
                        <FormItem className="space-y-1">
                          <div className="flex items-start gap-2">
                            <FormControl>
                              <Checkbox
                                id={name}
                                checked={!!field.value}
                                onCheckedChange={(c) => field.onChange(Boolean(c))}
                                data-testid={`checkbox-${name}`}
                              />
                            </FormControl>
                            <div>
                              <Label htmlFor={name} className="font-normal leading-snug">{label}</Label>
                              <a href={link} target="_blank" rel="noreferrer" className="block text-xs text-indigo-600 underline">{linkLabel}</a>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ))}

                    <FormField control={registerForm.control} name="marketingConsent" render={({ field }) => (
                      <FormItem className="space-y-1">
                        <div className="flex items-start gap-2">
                          <FormControl>
                            <Checkbox
                              id="marketingConsent"
                              checked={!!field.value}
                              onCheckedChange={(c) => field.onChange(Boolean(c))}
                              data-testid="checkbox-marketing"
                            />
                          </FormControl>
                          <Label htmlFor="marketingConsent" className="font-normal leading-snug text-gray-500">
                            Согласен(а) получать новости и предложения (необязательно)
                          </Label>
                        </div>
                      </FormItem>
                    )} />
                  </div>

                  <Button type="submit" className="w-full" disabled={registerForm.formState.isSubmitting} data-testid="button-register">
                    {registerForm.formState.isSubmitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Создаём аккаунт...</>
                    ) : (
                      <><ArrowRight className="mr-2 h-4 w-4" />Далее — настройка кампании</>
                    )}
                  </Button>
                </form>
              </Form>
              <div className="mt-4 text-center">
                <button onClick={() => navigate("/auth/login")} className="text-sm text-gray-500 hover:text-indigo-600 flex items-center gap-1 mx-auto">
                  <ArrowLeft className="w-3 h-3" />Уже есть аккаунт? Войти
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Создайте первую кампанию</h2>
              <p className="text-sm text-gray-500 mb-6">Шаг 2 из 3 — информация о вашем бизнесе</p>

              {campaignCreating ? (
                <div className="py-8 flex flex-col items-center gap-4">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                  <div className="w-full max-w-sm space-y-2">
                    {campaignProgress.map((msg, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                        {msg.startsWith("✓") ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        ) : msg.startsWith("⚠") ? (
                          <span className="w-4 h-4 shrink-0 text-amber-500">⚠</span>
                        ) : (
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500 shrink-0" />
                        )}
                        <span>{msg.replace(/^[✓⚠]\s/, "")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Form {...campaignForm}>
                  <form onSubmit={campaignForm.handleSubmit(onCampaignSubmit)} className="space-y-4">
                    <FormField control={campaignForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Название кампании</FormLabel>
                        <FormControl>
                          <Input placeholder="Например: Продвижение магазина" data-testid="input-campaign-name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={campaignForm.control} name="description" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Описание бизнеса</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Чем занимается ваш бизнес, кто ваша аудитория..." rows={3} data-testid="textarea-description" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={campaignForm.control} name="websiteUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Сайт <span className="text-gray-400 font-normal">(необязательно)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="https://your-site.ru" data-testid="input-website" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50">
                      <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <Rocket className="w-4 h-4 text-indigo-500" />
                        Автоматизация (если указан сайт)
                      </p>
                      {[
                        { name: "autoAnalyzeWebsite" as const, label: "Проанализировать сайт" },
                        { name: "autoFillQuestionnaire" as const, label: "Заполнить анкету на основе сайта" },
                        { name: "autoGenerateKeywords" as const, label: "Подобрать ключевые слова" },
                      ].map(({ name, label }) => (
                        <FormField key={name} control={campaignForm.control} name={name} render={({ field }) => (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={name}
                              checked={!!field.value}
                              onCheckedChange={(c) => field.onChange(Boolean(c))}
                              data-testid={`checkbox-${name}`}
                            />
                            <Label htmlFor={name} className="font-normal text-sm text-gray-600">{label}</Label>
                          </div>
                        )} />
                      ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(3)} data-testid="button-skip-campaign">
                        Пропустить
                      </Button>
                      <Button type="submit" className="flex-1" data-testid="button-create-campaign">
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Создать и продолжить
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Подключите социальные сети</h2>
              <p className="text-sm text-gray-500 mb-6">
                Шаг 3 из 3 — настройте публикации{" "}
                <span className="text-gray-400">(можно сделать позже в настройках кампании)</span>
              </p>

              <div className="space-y-3">
                {SOCIAL_NETWORKS.map((net) => {
                  const connected = completedNetworks.has(net.id);
                  return (
                    <div
                      key={net.id}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                        connected ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50"
                      }`}
                      data-testid={`social-card-${net.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-lg"
                          style={{ backgroundColor: net.color }}
                        >
                          <i className={net.icon} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{net.name}</p>
                          <p className="text-xs text-gray-400">{net.hint}</p>
                        </div>
                      </div>
                      {connected ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-700 border-0">
                          <CheckCircle2 className="w-3 h-3 mr-1" />Подключено
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-400 text-xs">
                          Настроить позже
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 p-3 bg-indigo-50 rounded-xl text-xs text-indigo-700 flex items-start gap-2">
                <i className="fas fa-info-circle mt-0.5 shrink-0" />
                <span>
                  Подключение соцсетей доступно в разделе <strong>Настройки кампании → Социальные сети</strong>.
                  Вы можете перейти туда сразу после завершения.
                </span>
              </div>

              <Button
                className="w-full mt-6"
                onClick={finishOnboarding}
                data-testid="button-finish-onboarding"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Завершить настройку
              </Button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          © 2025 SMM Manager · ИП Балуров Иван Викторович
        </p>
      </div>
    </div>
  );
}
