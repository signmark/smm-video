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

// Internal / test pages. They are NOT imported in production builds so
// their lazy chunks (and the dev-only auth-bypass mutation logic) never
// land in the production bundle.
const IS_DEV = import.meta.env.DEV;

const TestPublish = IS_DEV ? lazy(() => import("@/pages/publish/test-publish")) : null;
const ImageGenerationTest = IS_DEV ? lazy(() => import("@/pages/test/image-generation")) : null;
const TransparentDialogTest = IS_DEV ? lazy(() => import("@/pages/test/transparent-dialog-test")) : null;
const AuthBypass = IS_DEV ? lazy(() => import("@/pages/test/auth-bypass")) : null;
const AuthBypassRoute: React.ComponentType = devOnly(AuthBypass);
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
const InstagramSimplePage = IS_DEV ? lazy(() => import("@/pages/instagram-simple")) : null;
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

// Обертка Layout
const WithLayout = ({ Component }: { Component: React.ComponentType }) => (
  <Layout>
    <Component />
  </Layout>
);

// Утилита для мемоизированных компонентов с Layout
const wrapWithLayout = (Component: React.ComponentType) =>
  React.memo(() => <WithLayout Component={Component} />);

/**
 * Returns a route component that is only mounted in development. In
 * production the lazy import is `null`, so the Switch never registers
 * the route at all (see below) and even direct navigation falls through
 * to NotFound.
 */
function devOnly(Component: React.ComponentType | null): React.ComponentType {
  if (!Component) return () => <NotFound />;
  return wrapWithLayout(Component);
}

// Мемоизированные компоненты с Layout
const LayoutDashboard = wrapWithLayout(Dashboard);
const LayoutCampaigns = wrapWithLayout(Campaigns);
const LayoutCampaignDetails = wrapWithLayout(CampaignDetails);
const LayoutKeywords = wrapWithLayout(Keywords);
const LayoutContent = wrapWithLayout(Content);
const LayoutEditContentPage = wrapWithLayout(EditContentPage);
const LayoutPosts = wrapWithLayout(Posts);
const LayoutTrends = wrapWithLayout(Trends);
const LayoutAnalytics = wrapWithLayout(Analytics);
const LayoutScheduledPublications = wrapWithLayout(ScheduledPublications);
const LayoutCalendarView = wrapWithLayout(CalendarView);
const LayoutTestPublish = devOnly(TestPublish);
const LayoutImageGenerationTest = devOnly(ImageGenerationTest);
const LayoutTransparentDialogTest = devOnly(TransparentDialogTest);
const LayoutFalAiTest = devOnly(FalAiTest);
const LayoutApiKeyPriorityTest = devOnly(ApiKeyPriorityTest);
const LayoutApiKeysTest = devOnly(ApiKeysTest);
const LayoutUniversalImageGenTest = devOnly(UniversalImageGenTest);
const LayoutHtmlTagsTestPage = devOnly(HtmlTagsTestPage);
const LayoutAiImageTester = devOnly(AiImageTester);
const LayoutErrorHandlingTest = devOnly(ErrorHandlingTest);
const LayoutTestPage = devOnly(TestPage);
const LayoutGlobalApiKeysPage = wrapWithLayout(GlobalApiKeysPage);
const LayoutUserManagement = wrapWithLayout(UserManagement);
const LayoutEditorDemo = devOnly(EditorDemoPage);
const LayoutBusinessQuestionnaire = wrapWithLayout(BusinessQuestionnairePage);
const LayoutInstagramSetup = devOnly(InstagramSimplePage);
const LayoutStoriesGeneratorTest = devOnly(StoriesGeneratorTest);
const LayoutStoriesPage = wrapWithLayout(StoriesPage);
const LayoutTelegramChannelsAdmin = wrapWithLayout(TelegramChannelsAdmin);

// Wrapper для VideoStoryEditor — использует useParams вместо ручного парсинга URL
const LayoutVideoStoryEditor = React.memo(() => {
  const { storyId } = useParams<{ storyId: string }>();

  if (!storyId) {
    return <NotFound />;
  }

  return (
    <Layout>
      <VideoStoryEditor storyId={storyId} />
    </Layout>
  );
});

function Router() {
  return (
    <Switch>
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/register" component={Register} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/auth/reset-password" component={ResetPassword} />
      <Route path="/login" component={Login} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/payment/success" component={PaymentSuccessPage} />
      <Route path="/payment/cancel" component={PaymentCancelPage} />

      {/* Stories routes - нужно поставить ДО других роутов */}
      <Route path="/stories/:storyId/video-edit" component={LayoutVideoStoryEditor} />
      <Route path="/stories/:storyId/edit" component={LayoutStoriesPage} />
      <Route path="/stories/new" component={LayoutStoriesPage} />
      <Route path="/stories" component={LayoutStoriesPage} />

      <Route path="/campaigns" component={LayoutCampaigns} />
      <Route path="/campaigns/:id" component={LayoutCampaignDetails} />
      <Route path="/campaigns/:campaignId/stories/new" component={LayoutStoriesPage} />
      <Route path="/campaigns/:campaignId/stories/edit/:storyId" component={LayoutStoriesPage} />
      <Route path="/business-questionnaire/:id" component={LayoutBusinessQuestionnaire} />
      <Route path="/keywords" component={LayoutKeywords} />
      <Route path="/edit-content/:contentId" component={LayoutEditContentPage} />
      <Route path="/content/new" component={LayoutContent} />
      <Route path="/content" component={LayoutContent} />
      <Route path="/posts" component={LayoutPosts} />

      <Route path="/trends" component={LayoutTrends} />
      <Route path="/analytics" component={LayoutAnalytics} />
      <Route path="/ai-assistant" component={AIAssistantPage} />
      <Route path="/publish/scheduled" component={LayoutScheduledPublications} />
      <Route path="/publish/calendar" component={LayoutCalendarView} />
      <Route path="/publish/test" component={LayoutTestPublish} />
      <Route path="/test/image-generation" component={LayoutImageGenerationTest} />
      <Route path="/test/transparent-dialog" component={LayoutTransparentDialogTest} />
      <Route path="/test/auth-bypass" component={AuthBypassRoute} />
      <Route path="/test/fal-ai-test" component={LayoutFalAiTest} />
      <Route path="/test/api-key-priority" component={LayoutApiKeyPriorityTest} />
      <Route path="/test/api-keys" component={LayoutApiKeysTest} />
      <Route path="/editor-demo" component={LayoutEditorDemo} />
      <Route path="/test/universal-image-gen" component={LayoutUniversalImageGenTest} />
      <Route path="/test/html-tags" component={LayoutHtmlTagsTestPage} />
      <Route path="/test/telegram" component={TelegramTestPage} />
      <Route path="/test/ai-image" component={LayoutAiImageTester} />
      <Route path="/test/error-handling" component={LayoutErrorHandlingTest} />
      <Route path="/test/stories-generator" component={LayoutStoriesGeneratorTest} />
      <Route path="/admin/global-api-keys" component={LayoutGlobalApiKeysPage} />
      <Route path="/admin/users" component={LayoutUserManagement} />
      <Route path="/admin/telegram-channels" component={LayoutTelegramChannelsAdmin} />
      <Route path="/admin/promo-codes" component={() => <WithLayout Component={PromoCodesAdmin} />} />
      <Route path="/settings/instagram-setup" component={LayoutInstagramSetup} />

      {/* Video routes */}
      <Route path="/video" component={() => <WithLayout Component={VideoEditor} />} />

      {/* OAuth callbacks */}
      <Route path="/api/youtube/auth/callback" component={YouTubeCallback} />
      <Route path="/youtube-callback" component={YouTubeCallback} />
      <Route path="/instagram-callback" component={InstagramCallback} />
      <Route path="/vk-callback" component={VkCallback} />
      <Route path="/threads-callback" component={ThreadsCallback} />

      {/* Help routes */}
      <Route path="/help" component={HelpPage} />
      <Route path="/help/tutorials" component={TutorialsPage} />
      <Route path="/help/tutorials/:id" component={TutorialDetailsPage} />

      {/* Dashboard routes */}
      <Route path="/dashboard" component={LayoutDashboard} />

      {/* Корневой роут */}
      <Route path="/" component={LayoutDashboard} />
      {/* NotFound должен быть последним */}
      <Route component={NotFound} />
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
