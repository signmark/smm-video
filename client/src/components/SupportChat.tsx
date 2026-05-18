import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageCircle, 
  X, 
  Send, 
  Headphones,
  User,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/store";
import { apiRequest } from "@/lib/queryClient";

interface SupportMessage {
  id: string;
  type: 'user' | 'support';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
}

export function SupportChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([
    {
      id: '1',
      type: 'support',
      content: 'Здравствуйте! Я онлайн-поддержка SMM Manager 24/7. Чем могу помочь?',
      timestamp: new Date(),
      status: 'sent'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { userId } = useAuthStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: SupportMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
      status: 'sending'
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Отправляем сообщение в поддержку (Telegram или email) через apiRequest для правильной авторизации
      // userId берется из токена на бэкенде, не передаем его от клиента
      await apiRequest('/api/support/message', {
        method: 'POST',
        data: {
          message: userMessage.content
        }
      });

      // Обновляем статус сообщения
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      // Автоответ поддержки
      const supportResponse: SupportMessage = {
        id: (Date.now() + 1).toString(),
        type: 'support',
        content: 'Спасибо за ваше сообщение! Мы получили ваш запрос и ответим в ближайшее время. Вы также можете связаться с нами напрямую через:\n\n📧 Email: support@omemo.tech\n💬 Telegram: @smm_manager_support',
        timestamp: new Date(),
        status: 'sent'
      };

      setTimeout(() => {
        setMessages(prev => [...prev, supportResponse]);
      }, 500);

      toast({
        title: "Сообщение отправлено",
        description: "Мы получили ваш запрос и свяжемся с вами в ближайшее время."
      });

    } catch (error) {
      console.error('Failed to send support message:', error);
      
      // Обновляем статус сообщения на ошибку
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id ? { ...msg, status: 'error' } : msg
      ));

      toast({
        title: "Ошибка отправки",
        description: "Не удалось отправить сообщение. Попробуйте снова или свяжитесь с нами напрямую: support@omemo.tech",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      {/* Floating Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-40 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
        size="icon"
        data-testid="button-support-chat"
      >
        {isOpen ? (
          <X className="h-6 w-6 text-white" />
        ) : (
          <Headphones className="h-6 w-6 text-white" />
        )}
      </Button>

      {/* Chat Window */}
      {isOpen && (
        <Card className="fixed bottom-24 right-6 w-96 max-w-[calc(100vw-3rem)] h-[600px] shadow-2xl z-40 flex flex-col">
          <CardHeader className="border-b p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Headphones className="h-5 w-5" />
                <div>
                  <h3 className="font-semibold">Техподдержка</h3>
                  <div className="flex items-center gap-1 text-xs text-white/90">
                    <Clock className="h-3 w-3" />
                    <span>Онлайн 24/7</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 text-white hover:bg-white/20"
                data-testid="button-close-support"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-0 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-start gap-2 ${
                      message.type === 'user' ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full ${
                        message.type === 'support'
                          ? 'bg-gradient-to-r from-blue-500 to-purple-600'
                          : 'bg-primary'
                      }`}
                    >
                      {message.type === 'support' ? (
                        <Headphones className="h-4 w-4 text-white" />
                      ) : (
                        <User className="h-4 w-4 text-white" />
                      )}
                    </div>

                    <div
                      className={`flex flex-col gap-1 ${
                        message.type === 'user' ? 'items-end' : 'items-start'
                      } max-w-[75%]`}
                    >
                      <div
                        className={`rounded-lg px-4 py-2 ${
                          message.type === 'support'
                            ? 'bg-muted'
                            : 'bg-primary text-primary-foreground'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {message.content}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {message.timestamp.toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                        {message.status === 'error' && (
                          <span className="text-destructive ml-2">Ошибка отправки</span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Quick Actions */}
            <div className="border-t p-2 bg-muted/30">
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setInputValue("Как создать кампанию?")}
                  data-testid="button-quick-campaign"
                >
                  Как создать кампанию?
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setInputValue("Проблема с публикацией")}
                  data-testid="button-quick-publish"
                >
                  Проблема с публикацией
                </Button>
              </div>
            </div>

            {/* Input Area */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Напишите ваш вопрос..."
                  disabled={isLoading}
                  className="flex-1"
                  data-testid="input-support-message"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  size="icon"
                  data-testid="button-send-support"
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
