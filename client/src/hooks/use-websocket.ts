import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

export function useWebSocket() {
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Подключаемся к WebSocket серверу
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {

    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'scheduler_processing_start':
          case 'scheduler_processing_complete':
          case 'scheduled_content_found':
            break;
            
          case 'content_published':
            break;
            
          default:

        }
      } catch (error) {
        console.error('Ошибка обработки WebSocket сообщения:', error);
      }
    };

    ws.onclose = () => {

    };

    ws.onerror = (error) => {
      // Убираем избыточное логирование WebSocket ошибок
      // console.error('WebSocket error:', error);
    };

    // Cleanup при размонтировании
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [toast]);

  return wsRef.current;
}