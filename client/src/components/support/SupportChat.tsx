import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, Send, User, Bot, X, Phone, Headphones } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface SupportChatProps {
  onClose?: () => void;
  showFloatingButton?: boolean; // Показывать ли плавающую кнопку
}

declare global {
  interface Window {
    chatwootSDK?: {
      run: (config: { websiteToken: string; baseUrl: string }) => void;
      toggle: (state?: 'open' | 'close') => void;
    };
  }
}

export function SupportChat({ onClose, showFloatingButton = true }: SupportChatProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Загрузка истории из localStorage при монтировании
  useEffect(() => {
    const savedSessionId = localStorage.getItem('support_session_id');
    const savedMessages = localStorage.getItem('support_messages');
    
    if (savedSessionId) {
      setSessionId(savedSessionId);
    }
    
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        // Конвертируем timestamp обратно в Date объект
        const messagesWithDates = parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(messagesWithDates);
      } catch (error) {
        console.error('[SupportChat] Error loading messages from localStorage:', error);
      }
    }
  }, []);

  // Сохранение sessionId в localStorage
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('support_session_id', sessionId);
    }
  }, [sessionId]);

  // Сохранение сообщений в localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('support_messages', JSON.stringify(messages));
    }
  }, [messages]);

  // Автоскролл при новом сообщении
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);


  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');

    // Добавляем сообщение пользователя
    const newUserMessage: Message = {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/support/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          sessionId: sessionId,
          userId: localStorage.getItem('user_id')
        })
      });

      const response = await res.json();

      if (response.success && response.data) {
        // Сохраняем sessionId
        if (!sessionId) {
          setSessionId(response.data.sessionId);
        }

        // Добавляем ответ AI
        const aiMessage: Message = {
          role: 'assistant',
          content: response.data.response,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error('[SupportChat] Error sending message:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение. Попробуйте еще раз.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };


  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    onClose?.();
  };

  const handleClearHistory = () => {
    // Очищаем localStorage
    localStorage.removeItem('support_session_id');
    localStorage.removeItem('support_messages');
    
    // Очищаем state
    setSessionId(null);
    setMessages([]);
    
    toast({
      title: "История очищена",
      description: "Вы можете начать новый диалог"
    });
  };

  return (
    <>
      {/* Floating Button */}
      {showFloatingButton && (
        <Button
          onClick={() => setIsOpen(!isOpen)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-40 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
          size="icon"
          data-testid="button-support-chat"
          aria-label={isOpen ? t('support.closeLabel') : t('support.openLabel')}
          aria-expanded={isOpen}
          title={isOpen ? t('support.closeLabel') : t('support.openLabel')}
        >
          {isOpen ? (
            <X className="h-6 w-6 text-white" aria-hidden="true" />
          ) : (
            <Headphones className="h-6 w-6 text-white" aria-hidden="true" />
          )}
        </Button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <Card className="fixed bottom-24 right-6 w-96 max-w-[calc(100vw-3rem)] shadow-2xl z-40 flex flex-col" data-testid="card-support-chat">
      <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <CardTitle className="text-lg">Служба поддержки</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              className="text-white hover:bg-white/20"
              data-testid="button-clear-history"
              title="Очистить историю"
            >
              <span className="text-xs">Очистить</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="text-white hover:bg-white/20"
            data-testid="button-close-chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <ScrollArea className="h-[500px] p-4" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <Bot className="h-12 w-12 mb-4 text-blue-500" />
              <h3 className="text-lg font-semibold mb-2">Привет! 👋</h3>
              <p className="text-sm max-w-md">
                Я AI-помощник SMM Manager на базе Gemini. Могу помочь с вопросами о платформе, 
                генерации контента, настройке кампаний и многом другом!
              </p>
              <p className="text-xs mt-2 opacity-70">
                Задавайте любые вопросы - я постараюсь помочь 💡
              </p>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
                data-testid={`message-${message.role}-${index}`}
              >
                {message.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                )}
                
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-muted'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <span className="text-xs opacity-70 mt-1 block">
                    {new Date(message.timestamp).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>

                {message.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center">
                    <User className="h-5 w-5 text-white" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-white animate-pulse" />
                </div>
                <div className="bg-muted rounded-lg px-4 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Напишите ваш вопрос..."
              disabled={isLoading}
              className="flex-1"
              data-testid="input-support-message"
            />
            <Button
              onClick={sendMessage}
              disabled={isLoading || !inputMessage.trim()}
              data-testid="button-send-message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
        </Card>
      )}
    </>
  );
}
