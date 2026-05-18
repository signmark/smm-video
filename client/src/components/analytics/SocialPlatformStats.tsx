import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from "recharts";

// Типы для аналитики соц.сетей
export interface SocialPlatformData {
  name: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  url: string;
  postDate: string;
}

export interface PlatformAnalytics {
  platform: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    followers: number;
    growth: number;
  };
  posts: SocialPlatformData[];
}

interface SocialPlatformStatsProps {
  analytics: PlatformAnalytics[];
  isLoading: boolean;
}

export default function SocialPlatformStats({ analytics, isLoading }: SocialPlatformStatsProps) {
  // Подготовка данных для графиков по платформам
  const platformChartData = useMemo(() => {
    return analytics.map(platform => ({
      name: getPlatformDisplayName(platform.platform),
      views: platform.metrics.views,
      likes: platform.metrics.likes,
      comments: platform.metrics.comments,
      shares: platform.metrics.shares
    }));
  }, [analytics]);

  // Подготовка данных по постам (все платформы)
  const postAnalytics = useMemo(() => {
    return analytics.flatMap(platform => 
      platform.posts.map(post => ({
        ...post,
        platform: platform.platform,
        platformName: getPlatformDisplayName(platform.platform)
      }))
    ).sort((a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime());
  }, [analytics]);

  // Получаем топ-5 постов по просмотрам
  const topPosts = useMemo(() => {
    return [...postAnalytics]
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
  }, [postAnalytics]);

  // Получаем данные о подписчиках по платформам
  const followersData = useMemo(() => {
    return analytics.map(platform => ({
      name: getPlatformDisplayName(platform.platform),
      followers: platform.metrics.followers,
      growth: platform.metrics.growth
    }));
  }, [analytics]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Загрузка данных...</CardTitle>
        </CardHeader>
        <CardContent className="h-80 flex items-center justify-center">
          <div className="animate-pulse flex space-x-4">
            <div className="rounded-full bg-slate-100 h-10 w-10"></div>
            <div className="flex-1 space-y-6 py-1">
              <div className="h-2 bg-slate-100 rounded"></div>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-4">
                  <div className="h-2 bg-slate-100 rounded col-span-2"></div>
                  <div className="h-2 bg-slate-100 rounded col-span-1"></div>
                </div>
                <div className="h-2 bg-slate-100 rounded"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Статистика по социальным сетям</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="grid grid-cols-4 mb-6">
            <TabsTrigger value="overview">Общий обзор</TabsTrigger>
            <TabsTrigger value="engagement">Вовлеченность</TabsTrigger>
            <TabsTrigger value="followers">Подписчики</TabsTrigger>
            <TabsTrigger value="top-posts">Топ постов</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={platformChartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 70 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} />
                <YAxis />
                <Tooltip
                  formatter={(value, name) => [value, 
                    name === "views" ? "Просмотры" : 
                    name === "likes" ? "Лайки" : 
                    name === "comments" ? "Комментарии" : 
                    "Репосты"
                  ]}
                  labelFormatter={(label) => `Платформа: ${label}`}
                />
                <Legend 
                  formatter={(value) => 
                    value === "views" ? "Просмотры" : 
                    value === "likes" ? "Лайки" : 
                    value === "comments" ? "Комментарии" : 
                    "Репосты"
                  }
                />
                <Bar dataKey="views" fill="#8884d8" name="views" />
                <Bar dataKey="likes" fill="#82ca9d" name="likes" />
                <Bar dataKey="comments" fill="#ffc658" name="comments" />
                <Bar dataKey="shares" fill="#ff8042" name="shares" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="engagement" className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={platformChartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 70 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} />
                <Tooltip
                  formatter={(value, name) => [value, 
                    name === "likes" ? "Лайки" : 
                    name === "comments" ? "Комментарии" : 
                    "Репосты"
                  ]}
                  labelFormatter={(label) => `Платформа: ${label}`}
                />
                <Legend 
                  formatter={(value) => 
                    value === "likes" ? "Лайки" : 
                    value === "comments" ? "Комментарии" : 
                    "Репосты"
                  }
                />
                <Bar dataKey="likes" fill="#82ca9d" name="likes" />
                <Bar dataKey="comments" fill="#ffc658" name="comments" />
                <Bar dataKey="shares" fill="#ff8042" name="shares" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="followers" className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={followersData}
                margin={{ top: 20, right: 30, left: 20, bottom: 70 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} />
                <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                <Tooltip
                  formatter={(value, name) => [value, 
                    name === "followers" ? "Подписчики" : "Прирост"
                  ]}
                  labelFormatter={(label) => `Платформа: ${label}`}
                />
                <Legend 
                  formatter={(value) => 
                    value === "followers" ? "Подписчики" : "Прирост"
                  }
                />
                <Bar dataKey="followers" fill="#8884d8" name="followers" yAxisId="left" />
                <Bar dataKey="growth" fill="#82ca9d" name="growth" yAxisId="right" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="top-posts">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 px-4 text-left">Платформа</th>
                    <th className="py-2 px-4 text-left">Название</th>
                    <th className="py-2 px-4 text-right">Просмотры</th>
                    <th className="py-2 px-4 text-right">Лайки</th>
                    <th className="py-2 px-4 text-right">Комментарии</th>
                    <th className="py-2 px-4 text-right">Дата публикации</th>
                    <th className="py-2 px-4 text-center">Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {topPosts.map((post, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4">{post.platformName}</td>
                      <td className="py-2 px-4 truncate max-w-xs">{post.name}</td>
                      <td className="py-2 px-4 text-right">{post.views}</td>
                      <td className="py-2 px-4 text-right">{post.likes}</td>
                      <td className="py-2 px-4 text-right">{post.comments}</td>
                      <td className="py-2 px-4 text-right">{formatDate(post.postDate)}</td>
                      <td className="py-2 px-4 text-center">
                        {post.url && (
                          <a 
                            href={post.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            Открыть
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {topPosts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-gray-500">
                        Нет данных о постах
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Вспомогательные функции
function getPlatformDisplayName(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'telegram':
      return 'Telegram';
    case 'vk':
      return 'ВКонтакте';
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    default:
      return platform;
  }
}

function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}