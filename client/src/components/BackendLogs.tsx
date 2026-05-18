import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export const BackendLogs = () => {
  const [isPaused, setIsPaused] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const token = useAuthStore((state) => state.token);

  const { data: logsData, isLoading } = useQuery({
    queryKey: ['/api/debug/logs'],
    queryFn: async () => {
      if (!token) return { logs: [], total: 0 };
      
      const response = await fetch('/api/debug/logs?limit=50', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response.json();
    },
    enabled: !!token && !isPaused,
    refetchInterval: 2000, // Обновление каждые 2 секунды
    staleTime: 0
  });

  // Автоматическая прокрутка к концу логов
  useEffect(() => {
    if (!isCollapsed && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logsData?.logs, isCollapsed]);

  const logs = logsData?.logs || [];
  const total = logsData?.total || 0;

  const getLogColor = (log: string) => {
    if (log.includes('ERROR:')) return 'text-red-500';
    if (log.includes('WARNING:') || log.includes('⚠️')) return 'text-yellow-500';
    if (log.includes('SUCCESS:') || log.includes('✅')) return 'text-green-500';
    if (log.includes('DEBUG:') || log.includes('🔍')) return 'text-blue-500';
    if (log.includes('INFO:') || log.includes('ℹ️')) return 'text-cyan-500';
    if (log.includes('IS-ADMIN ROUTE CALLED')) return 'text-purple-500 font-semibold';
    if (log.includes('STORIES')) return 'text-indigo-500';
    return 'text-gray-300';
  };

  if (!token) {
    return null; // Скрываем компонент если нет токена
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40">
      <Card className="bg-gray-900 border-gray-700 text-white">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              📊 Backend Logs
              <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                {total} всего
              </Badge>
              {isLoading && (
                <Badge variant="outline" className="border-blue-500 text-blue-400">
                  Загрузка...
                </Badge>
              )}
            </CardTitle>
            
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={isPaused ? "default" : "secondary"}
                onClick={() => setIsPaused(!isPaused)}
                className="text-xs"
              >
                {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {isPaused ? 'Возобновить' : 'Пауза'}
              </Button>
              
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-xs"
              >
                {isCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {isCollapsed ? 'Показать' : 'Скрыть'}
              </Button>
            </div>
          </div>
        </CardHeader>
        
        {!isCollapsed && (
          <CardContent className="pt-0">
            <div className="h-64 overflow-y-auto bg-gray-800 rounded-lg p-3 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-gray-400 text-center py-8">
                  {isLoading ? 'Загрузка логов...' : 'Логи не найдены'}
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div 
                      key={index} 
                      className={`whitespace-pre-wrap break-words ${getLogColor(log)}`}
                    >
                      {log}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
            
            <div className="mt-2 text-xs text-gray-400 text-center">
              Обновление каждые 2 секунды • Последние 50 записей
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
};