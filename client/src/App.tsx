import React, { useEffect, Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CookieBanner } from "@/components/CookieBanner";

// Принудительная очистка истекшего токена
const clearExpiredToken = () => {
  // НЕ проверяем токен на страницах аутентификации
  const currentPath = window.location.pathname;
  if (currentPath === '/login' || currentPath === '/auth/login' || currentPath === '/auth/register' || currentPath === '/auth/forgot-password' || currentPath === '/auth/reset-password') {
    return;
  }

  const token = localStorage.getItem('auth_token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        ['auth_token','refresh_token','user_id','is_admin','selected_campaign_id','selected_campaign_name'].forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
        window.location.href = '/login';
      }
    } catch (e) {
      ['auth_token','refresh_token','user_id','is_admin','selected_campaign_id','selected_campaign_name'].forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      window.location.href = '/login';
    }
  }
};
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
const TestPublish = lazy(() => import("@/pages/publish/test-publish"));
const ImageGenerationTest = lazy(() => import("@/pages/test/image-generation"));
const TransparentDialogTest = lazy(() => import("@/pages/test/transparent-dialog-test"));
const AuthBypass = lazy(() => import("@/pages/test/auth-bypass"));
const FalAiTest = lazy(() => import("@/pages/test/fal-ai-test"));
const ApiKeyPriorityTest = lazy(() => import("@/pages/test/api-key-priority"));
const ApiKeysTest = lazy(() => import("@/pages/test/api-keys"));
const UniversalImageGenTest = lazy(() => import("@/pages/test/universal-image-gen"));
const TimeDisplayTest = lazy(() => import("@/pages/test/time-display-test"));
const ErrorHandlingTest = lazy(() => import("@/pages/test/error-handling-test"));
const GlobalApiKeysPage = lazy(() => import("@/pages/admin/global-api-keys"));
const UserManagement = lazy(() => import("@/pages/admin/UserManagement"));
const TelegramChannelsAdmin = lazy(() => import("@/pages/admin/telegram-channels"));
const PromoCodesAdmin = lazy(() => import("@/pages/admin/promo-codes"));
const TestPage = lazy(() => import("@/pages/test/index"));
const HtmlTagsTestPage = lazy(() => import("@/pages/HtmlTagsTestPage"));
const TelegramTestPage = lazy(() => import("@/pages/telegram-test"));
const EditorDemoPage = lazy(() => import("@/pages/editor-demo"));
const AiImageTester = lazy(() => import("@/pages/AiImageTester"));
const InstagramSimplePage = lazy(() => import("@/pages/instagram-simple"));
const NotFound = lazy(() => import("@/pages/not-found"));
const VideoEditor = lazy(() => import("@/pages/video"));
const YouTubeCallback = lazy(() => import("@/pages/youtube-callback"));
const InstagramCallback = lazy(() => import("@/pages/instagram-callback"));
const TikTokCallback = lazy(() => import("@/pages/tiktok-callback"));
const VkCallback = lazy(() => import("@/pages/vk-callback"));
const ThreadsCallback = lazy(() => import("@/pages/threads-callback"));
const AIAssistantPage = lazy(() => import("@/pages/ai-assistant"));

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
const StoriesGeneratorTest = lazy(() => import("@/pages/test/stories-generator-test"));
const VideoStoryEditor = lazy(() => import("@/components/stories/VideoStoryEditor"));
const PricingPage = lazy(() => import("@/pages/pricing"));
const PaymentSuccessPage = lazy(() => import("@/pages/payment/success"));
const PaymentCancelPage = lazy(() => import("@/pages/payment/cancel"));

// Создаем обертки для компонентов с Layout
const WithLayout = ({ Component }: { Component: React.ComponentType }) => (
  <Layout>
    <Component />
  </Layout>
);

// Мемоизированные компоненты с Layout
const LayoutDashboard = React.memo(() => <WithLayout Component={Dashboard} />);
const LayoutCampaigns = React.memo(() => <WithLayout Component={Campaigns} />);
const LayoutCampaignDetails = React.memo(() => <WithLayout Component={CampaignDetails} />);
const LayoutKeywords = React.memo(() => <WithLayout Component={Keywords} />);
const LayoutContent = React.memo(() => <WithLayout Component={Content} />);
const LayoutEditContentPage = React.memo(() => <WithLayout Component={EditContentPage} />);
const LayoutPosts = React.memo(() => <WithLayout Component={Posts} />);

const LayoutTrends = React.memo(() => <WithLayout Component={Trends} />);
const LayoutAnalytics = React.memo(() => <WithLayout Component={Analytics} />);
const LayoutScheduledPublications = React.memo(() => <WithLayout Component={ScheduledPublications} />);
const LayoutCalendarView = React.memo(() => <WithLayout Component={CalendarView} />);
const LayoutTestPublish = React.memo(() => <WithLayout Component={TestPublish} />);
const LayoutImageGenerationTest = React.memo(() => <WithLayout Component={ImageGenerationTest} />);
const LayoutTransparentDialogTest = React.memo(() => <WithLayout Component={TransparentDialogTest} />);
const LayoutFalAiTest = React.memo(() => <WithLayout Component={FalAiTest} />);
const LayoutApiKeyPriorityTest = React.memo(() => <WithLayout Component={ApiKeyPriorityTest} />);
const LayoutApiKeysTest = React.memo(() => <WithLayout Component={ApiKeysTest} />);
const LayoutUniversalImageGenTest = React.memo(() => <WithLayout Component={UniversalImageGenTest} />);
const LayoutHtmlTagsTestPage = React.memo(() => <WithLayout Component={HtmlTagsTestPage} />);
const LayoutAiImageTester = React.memo(() => <WithLayout Component={AiImageTester} />);
const LayoutErrorHandlingTest = React.memo(() => <WithLayout Component={ErrorHandlingTest} />);
const LayoutTestPage = React.memo(() => <WithLayout Component={TestPage} />);
const LayoutGlobalApiKeysPage = React.memo(() => <WithLayout Component={GlobalApiKeysPage} />);
const LayoutUserManagement = React.memo(() => <WithLayout Component={UserManagement} />);
const LayoutEditorDemo = React.memo(() => <WithLayout Component={EditorDemoPage} />);
const LayoutBusinessQuestionnaire = React.memo(() => <WithLayout Component={BusinessQuestionnairePage} />);
const LayoutInstagramSetup = React.memo(() => <WithLayout Component={InstagramSimplePage} />);
const LayoutStoriesGeneratorTest = React.memo(() => <WithLayout Component={StoriesGeneratorTest} />);
const LayoutStoriesPage = React.memo(() => <WithLayout Component={StoriesPage} />);
const LayoutTelegramChannelsAdmin = React.memo(() => <WithLayout Component={TelegramChannelsAdmin} />);

// Wrapper для VideoStoryEditor
const LayoutVideoStoryEditor = React.memo(() => {
  const path = window.location.pathname;
  const storyId = path.match(/\/stories\/([^\/]+)\/video-edit/)?.[1];

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
      <Route path="/test/auth-bypass" component={AuthBypass} />
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
      <Route path="/tiktok-callback" component={TikTokCallback} />
      <Route path="/vk-callback" component={VkCallback} />
      <Route path="/threads-callback" component={ThreadsCallback} />


      {/* Help routes */}
      <Route path="/help" component={HelpPage} />
      <Route path="/help/tutorials" component={TutorialsPage} />
      <Route path="/help/tutorials/:id" component={TutorialDetailsPage} />


      {/* Dashboard routes */}
      <Route path="/dashboard" component={LayoutDashboard} />

      {/* Добавляем корневой роут - теперь ведет на Dashboard */}
      <Route path="/" component={LayoutDashboard} />
      {/* NotFound должен быть последним */}
      <Route component={NotFound} />
    </Switch>
  );
}

// Отдельный компонент для инициализации WebSocket внутри провайдеров
function AppWithWebSocket() {
  // Инициализируем WebSocket соединение для real-time уведомлений
  useWebSocket();

  return <Router />;
}

function App() {
  // ПРИНУДИТЕЛЬНАЯ проверка токенов каждую секунду
  useEffect(() => {
    // Первоначальная проверка
    clearExpiredToken();

    // Интервальная проверка
    const interval = setInterval(() => {
      clearExpiredToken();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

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