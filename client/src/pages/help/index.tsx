
import React from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, BookOpen, MessageCircle, Search, Zap, Users } from 'lucide-react';

export default function HelpPage() {
  const helpSections = [
    {
      icon: Video,
      title: 'Видео-инструкции',
      description: 'Пошаговые видео-уроки по всем функциям системы',
      link: '/help/tutorials',
      color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
    },
    {
      icon: Zap,
      title: 'Быстрый старт',
      description: 'Настройка системы за 5 минут',
      link: '/help/quick-start',
      color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
    },
    {
      icon: Users,
      title: 'Сообщество',
      description: 'Форум пользователей и обмен опытом',
      link: '/help/community',
      color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-700 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            🆘 Центр помощи SMM Manager
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Найдите ответы на все вопросы по использованию системы управления социальными медиа
          </p>
        </div>

        {/* Поиск */}
        <Card className="mb-8 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 h-5 w-5" />
              <input
                type="text"
                placeholder="Поиск по документации..."
                className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>
          </CardContent>
        </Card>

        {/* Разделы помощи */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {helpSections.map((section, index) => (
            <Link key={index} href={section.link}>
              <Card className="h-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm hover:shadow-lg transition-all cursor-pointer">
                <CardHeader className="text-center">
                  <div className={`w-16 h-16 rounded-full ${section.color} flex items-center justify-center mx-auto mb-4`}>
                    <section.icon className="h-8 w-8" />
                  </div>
                  <CardTitle className="text-lg text-gray-900 dark:text-white">{section.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-gray-600 dark:text-gray-300 text-sm">{section.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Популярные вопросы */}
        <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm mb-8">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">🔥 Популярные вопросы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Как подключить Instagram аккаунт?</h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  Перейдите в раздел "Настройки" → "Социальные сети" → "Instagram". Нажмите "Подключить аккаунт" 
                  и следуйте инструкциям авторизации через Instagram Business API.
                </p>
              </div>
              
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Как настроить автоматическую публикацию?</h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  В разделе "Публикации" создайте новый пост, выберите дату и время публикации. 
                  Система автоматически опубликует контент в назначенное время.
                </p>
              </div>
              
              <div className="border-l-4 border-purple-500 pl-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Как создать Stories с видео?</h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  Используйте встроенный редактор Stories: добавьте текст, изображения, настройте анимацию. 
                  Система создаст видео в формате 1080x1920 для Instagram.
                </p>
              </div>
              
              <div className="border-l-4 border-orange-500 pl-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Как использовать AI для генерации контента?</h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  В разделе "Контент" нажмите "Создать с ИИ". Укажите тему, целевую аудиторию и тон. 
                  ИИ сгенерирует текст, подберет хештеги и предложит визуальное оформление.
                </p>
              </div>
              
              <div className="border-l-4 border-red-500 pl-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Как анализировать статистику публикаций?</h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  Раздел "Аналитика" показывает охват, вовлеченность, лучшее время для публикации. 
                  Используйте данные для оптимизации контент-стратегии.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Руководства по функциям */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">📚 Основные функции</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded-full flex items-center justify-center text-xs font-semibold">1</span>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Управление аккаунтами</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Подключение и настройка социальных сетей</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 rounded-full flex items-center justify-center text-xs font-semibold">2</span>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Создание контента</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Текст, изображения, Stories с ИИ</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 rounded-full flex items-center justify-center text-xs font-semibold">3</span>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Планирование публикаций</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Календарь и автопубликация</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 rounded-full flex items-center justify-center text-xs font-semibold">4</span>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Аналитика и отчеты</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Метрики эффективности контента</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">⚡ Быстрые действия</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Button variant="outline" className="w-full justify-start">
                  <Video className="h-4 w-4 mr-2" />
                  Создать новый пост
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Запланировать публикацию
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Zap className="h-4 w-4 mr-2" />
                  Сгенерировать контент с ИИ
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Users className="h-4 w-4 mr-2" />
                  Посмотреть аналитику
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Советы и рекомендации */}
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-700 dark:to-gray-600 border-blue-200 dark:border-gray-600">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">💡 Советы для эффективной работы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-xl">📅</span>
                </div>
                <h4 className="font-medium mb-1">Планируйте заранее</h4>
                <p className="text-sm text-gray-600">Создавайте контент-план на неделю вперед</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-xl">🎯</span>
                </div>
                <h4 className="font-medium mb-1">Используйте аналитику</h4>
                <p className="text-sm text-gray-600">Отслеживайте лучшее время для публикаций</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-xl">🤖</span>
                </div>
                <h4 className="font-medium mb-1">Экспериментируйте с ИИ</h4>
                <p className="text-sm text-gray-600">Генерируйте разнообразный контент автоматически</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
