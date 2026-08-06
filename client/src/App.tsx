import React, { Suspense, lazy } from "react";
import { Switch, Route, useParams } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CookieBanner } from "@/components/CookieBanner";

// Глобальный перехват ?ref= — вызывается СИНХРОННО на уровне модуля,
// до первого рендера React, пока URL ещё содержит ?ref=
const captureRefCode = () => {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref && ref.trim()) {
    localStorage.setItem('smm_partner_code', ref.trim().toUpperCase());
  }
};
captureRefCode(); // ← выполняется сразу при импорте модуля, до рендера

// Lazy loading для основных страниц - это ускоряет первоначальную загрузку
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Campaigns = lazy(() => import("@/pages/campaigns"));
const CampaignDetails = lazy(() => import("@/pages/campaigns/[id]"));
const Keywords = lazy(() => import("@/pages/keywords"));
const Posts = lazy(() => import("@/pages/posts"));
const Analytics = lazy(() => import("@/pages/analytics"));
const Trends = lazy(() => import("@/pages/trends"));
const Content = lazy(() => import("@/pages/content"));
const EditContentPage = lazy(() => import("@/pages/content/EditContentPage"));
const ScheduledPublications = lazy(() => import("@/pages/publish/scheduled"));
const CalendarView = lazy(() => import("@/pages/publish/calendar"));
const BusinessQuestionnairePage = lazy(() => import("@/pages/business-questionnaire"));
const StoriesPage = lazy(() => import("@/pages/stories"));

// Lazy loading для дополнительных страниц
const Login = lazy(() => import("@/pages/auth/login"));
const Register = lazy(() => import("@/pages/auth/register"));
const ForgotPassword = lazy(() => import("@/pages/auth/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/auth/reset-password"));
const ConfirmEmail = lazy(() => import("@/pages/auth/confirm-email"));
const GlobalApiKeysPage = lazy(() => import("@/pages/admin/global-api-keys"));
const UserManagement = lazy(() => import("@/pages/admin/UserManagement"));
const TelegramChannelsAdmin = lazy(() => import("@/pages/admin/telegram-channels"));
const PromoCodesAdmin = lazy(() => import("@/pages/admin/promo-codes"));
const NotFound = lazy(() => import("@/pages/not-found"));
const VideoEditor = lazy(() => import("@/pages/video"));
const YouTubeCallback = lazy(() => import("@/pages/youtube-callback"));
const InstagramCallback = lazy(() => import("@/pages/instagram-callback"));
const VkCallback = lazy(() => import("@/pages/vk-callback"));
const ThreadsCallback = lazy(() => import("@/pages/threads-callback"));
const AIAssistantPage = lazy(() => import("@/pages/ai-assistant"));
const InstagramSimplePage = lazy(() => import("@/pages/instagram-simple"));

// Internal / test pages. They are NOT imported in production builds so
// their lazy chunks (and the dev-only auth-bypass mutation logic) never
// land in the production bundle.
const IS_DEV = import.meta.env.DEV;

const TestPublish = IS_DEV ? lazy(() => import("@/pages/publish/test-publish")) : null;
const ImageGenerationTest = IS_DEV ? lazy(() => import("@/pages/test/image-generation")) : null;
const TransparentDialogTest = IS_DEV ? lazy(() => import("@/pages/test/transparent-dialog-test")) : null;
const AuthBypass = IS_DEV ? lazy(() => import("@/pages/test/auth-bypass")) : null;
// AuthBypass intentionally bypasses the Layout: the page exists to
// mint a fake auth token in localStorage so a Playwright/curl smoke
// test can reach an authenticated route. Wrapping it in Layout makes
// the AppShell/Sidebar render against the (still-empty) auth store
// for the brief window before the page's useEffect sets the token
// and navigates away, which can show a half-broken logged-out chrome
// and, in the dev Playwright runs that exercise this page, leaves
// dangling queries.
const AuthBypassRoute: React.ComponentType = IS_DEV
  ? React.memo(() => (AuthBypass ? <AuthBypass /> : <NotFound />))
  : () => <NotFound />;
const FalAiTest = IS_DEV ? lazy(() => import("@/pages/test/fal-ai-test")) : null;
const ApiKeyPriorityTest = IS_DEV ? lazy(() => import("@/pages/test/api-key-priority")) : null;
const ApiKeysTest = IS_DEV ? lazy(() => import("@/pages/test/api-keys")) : null;
const UniversalImageGenTest = IS_DEV ? lazy(() => import("@/pages/test/universal-image-gen")) : null;
const TimeDisplayTest = IS_DEV ? lazy(() => import("@/pages/test/time-display-test")) : null;
const ErrorHandlingTest = IS_DEV ? lazy(() => import("@/pages/test/error-handling-test")) : null;
const TestPage = IS_DEV ? lazy(() => import("@/pages/test/index")) : null;
const HtmlTagsTestPage = IS_DEV ? lazy(() => import("@/pages/HtmlTagsTestPage")) : null;
const TelegramTestPage = IS_DEV ? lazy(() => import("@/pages/telegram-test")) : null;
const EditorDemoPage = IS_DEV ? lazy(() => import("@/pages/editor-demo")) : null;
const AiImageTester = IS_DEV ? lazy(() => import("@/pages/AiImageTester")) : null;
const StoriesGeneratorTest = IS_DEV ? lazy(() => import("@/pages/test/stories-generator-test")) : null;

// Компоненты системы (не lazy, т.к. нужны всегда)
import { Layout } from "@/components/Layout";
import { AuthProvider } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/AuthGuard";
import { useWebSocket } from "@/hooks/use-websocket";
import HelpPage from './pages/help';
import TutorialsPage from './pages/help/tutorials';
import TutorialDetailsPage from './pages/help/tutorial-details';

// Lazy loading для специальных компонентов
const StoryEditor = lazy(() => import("@/components/stories/StoryEditor"));
const VideoStoryEditor = lazy(() => import("@/components/stories/VideoStoryEditor"));
const PricingPage = lazy(() => import("@/pages/pricing"));
const PaymentSuccessPage = lazy(() => import("@/pages/payment/success"));
const PaymentCancelPage = lazy(() => import("@/pages/payment/cancel"));

/**
 * Returns a route component that is only mounted in development. In
 * production the lazy import is `null`, so the Switch never registers
 * the route at all (see below) and even direct navigation falls through
 * to NotFound.
 */
function devOnly(Component: React.ComponentType | null): React.ComponentType {
  if (!Component) return () => <NotFound />;
  return Component;
}

// Защищённые роуты: все маунтятся под одним <Layout>, поэтому при переходе
// каркас (Sidebar/Topbar/AuthStore/CampaignStore/ThemeProvider/useCampaignOwnershipCheck)
// остаётся стабильным, а меняется только содержимое внутри <Layout>.
/**
 * Загрузка ВНУТРИ каркаса, а не вместо него.
 *
 * Страницы грузятся лениво (React.lazy), и до этой правки ближайшей границей
 * Suspense была внешняя — та, что оборачивает всё приложение. Поэтому при
 * первом заходе на любой раздел React размонтировал вообще всё, включая
 * Sidebar и Topbar, и показывал спиннер на весь экран. Каркас собирался
 * заново на каждой новой странице — ровно то, на что жаловался владелец.
 *
 * Своя граница внутри <Layout> держит каркас смонтированным: подгружается
 * только содержимое, а меню и верхняя панель не мигают.
 */
const ContentLoading = () => (
  <div className="flex items-center justify-center py-24">
    <div className="flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary/30 border-t-primary" />
      <p className="text-sm text-muted-foreground">Загрузка…</p>
    </div>
  </div>
);

const ProtectedRoutes = () => (
  <Layout>
    <Suspense fallback={<ContentLoading />}>
    <Switch>
      {/* Stories routes - нужно поставить ДО других роутов */}
      <Route path="/stories/:storyId/video-edit" component={VideoStoryEditorRoute} />
      <Route path="/stories/:storyId/edit" component={StoriesPage} />
      <Route path="/stories/new" component={StoriesPage} />
      <Route path="/stories" component={StoriesPage} />

      <Route path="/campaigns" component={Campaigns} />
      <Route path="/campaigns/:id" component={CampaignDetails} />
      <Route path="/campaigns/:campaignId/stories/new" component={StoriesPage} />
      <Route path="/campaigns/:campaignId/stories/edit/:storyId" component={StoriesPage} />
      <Route path="/business-questionnaire/:id" component={BusinessQuestionnairePage} />
      <Route path="/keywords" component={Keywords} />
      <Route path="/edit-content/:contentId" component={EditContentPage} />
      <Route path="/content/new" component={Content} />
      <Route path="/content" component={Content} />
      <Route path="/posts" component={Posts} />

      <Route path="/trends" component={Trends} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/ai-assistant" component={AIAssistantPage} />
      <Route path="/publish/scheduled" component={ScheduledPublications} />
      <Route path="/publish/calendar" component={CalendarView} />
      {IS_DEV && <Route path="/publish/test" component={devOnly(TestPublish)} />}
      {IS_DEV && <Route path="/test/image-generation" component={devOnly(ImageGenerationTest)} />}
      {IS_DEV && <Route path="/test/transparent-dialog" component={devOnly(TransparentDialogTest)} />}
      {IS_DEV && <Route path="/test/fal-ai-test" component={devOnly(FalAiTest)} />}
      {IS_DEV && <Route path="/test/api-key-priority" component={devOnly(ApiKeyPriorityTest)} />}
      {IS_DEV && <Route path="/test/api-keys" component={devOnly(ApiKeysTest)} />}
      {IS_DEV && <Route path="/editor-demo" component={devOnly(EditorDemoPage)} />}
      {IS_DEV && <Route path="/test/universal-image-gen" component={devOnly(UniversalImageGenTest)} />}
      {IS_DEV && <Route path="/test/html-tags" component={devOnly(HtmlTagsTestPage)} />}
      {IS_DEV && <Route path="/test/telegram" component={devOnly(TelegramTestPage)} />}
      {IS_DEV && <Route path="/test/ai-image" component={devOnly(AiImageTester)} />}
      {IS_DEV && <Route path="/test/error-handling" component={devOnly(ErrorHandlingTest)} />}
      {IS_DEV && <Route path="/test/stories-generator" component={devOnly(StoriesGeneratorTest)} />}
      <Route path="/admin/global-api-keys" component={GlobalApiKeysPage} />
      <Route path="/admin/users" component={UserManagement} />
      <Route path="/admin/telegram-channels" component={TelegramChannelsAdmin} />
      <Route path="/admin/promo-codes" component={PromoCodesAdmin} />
      <Route path="/settings/instagram-setup" component={InstagramSimplePage} />

      {/* Video routes */}
      <Route path="/video" component={VideoEditor} />

      {/* Dashboard routes */}
      <Route path="/dashboard" component={Dashboard} />

      {/* Корневой роут */}
      <Route path="/" component={Dashboard} />
      {/* NotFound должен быть последним */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  </Layout>
);

// Inline route для /stories/:storyId/video-edit: единственный защищённый путь,
// которому нужен useParams до того, как wouter отдаст props.
const VideoStoryEditorRoute = () => {
  const { storyId } = useParams<{ storyId: string }>();
  if (!storyId) return <NotFound />;
  return <VideoStoryEditor storyId={storyId} />;
};

function Router() {
  // Один внешний <Switch>: публичные роуты первыми, защищённые —
  // последней fallback-строкой через <Route component={ProtectedRoutes}>.
  // Это гарантирует, что /login (и любой другой публичный путь)
  // матчится ровно один раз, а не рендерится параллельно с защищённым
  // fallback'ом внутри <Layout>.
  return (
    <Switch>
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/register" component={Register} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/auth/reset-password" component={ResetPassword} />
      <Route path="/auth/confirm-email" component={ConfirmEmail} />
      <Route path="/login" component={Login} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/payment/success" component={PaymentSuccessPage} />
      <Route path="/payment/cancel" component={PaymentCancelPage} />
      <Route path="/api/youtube/auth/callback" component={YouTubeCallback} />
      <Route path="/youtube-callback" component={YouTubeCallback} />
      <Route path="/instagram-callback" component={InstagramCallback} />
      <Route path="/vk-callback" component={VkCallback} />
      <Route path="/threads-callback" component={ThreadsCallback} />
      <Route path="/help" component={HelpPage} />
      <Route path="/help/tutorials" component={TutorialsPage} />
      <Route path="/help/tutorials/:id" component={TutorialDetailsPage} />
      {/* Dev-only auth bypass must NOT live under <Layout>/AuthGuard. */}
      {IS_DEV && <Route path="/test/auth-bypass" component={AuthBypassRoute} />}
      <Route component={ProtectedRoutes} />
    </Switch>
  );
}

function AppWithWebSocket() {
  useWebSocket();
  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <CookieBanner />
      <AuthProvider>
        <AuthGuard>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen bg-background">
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary/30 border-t-primary"></div>
                <p className="text-sm text-muted-foreground animate-pulse">Загрузка...</p>
              </div>
            </div>
          }>
            <AppWithWebSocket />
          </Suspense>
        </AuthGuard>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
