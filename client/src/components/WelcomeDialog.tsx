import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Sparkles, BookOpen, LayoutDashboard, TrendingUp, Send, BrainCircuit } from "lucide-react";

export function WelcomeDialog() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const isNewUser = localStorage.getItem("smm_new_user");
    if (isNewUser === "true") {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.removeItem("smm_new_user");
    setOpen(false);
  };

  const handleGoToTutorials = () => {
    localStorage.removeItem("smm_new_user");
    setOpen(false);
    navigate("/help/tutorials");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Добро пожаловать в SMM Manager!
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Платформа поможет вам управлять контентом в социальных сетях: от создания до публикации. Вот что вы сможете делать:
          </p>

          <div className="grid gap-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <BrainCircuit className="h-5 w-5 mt-0.5 text-violet-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">AI-генерация контента</p>
                <p className="text-xs text-muted-foreground">Создавайте тексты, изображения и видео с помощью искусственного интеллекта</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <TrendingUp className="h-5 w-5 mt-0.5 text-green-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">Сбор и анализ трендов</p>
                <p className="text-xs text-muted-foreground">Отслеживайте популярные темы и создавайте контент на их основе</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Send className="h-5 w-5 mt-0.5 text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">Публикация в соцсети</p>
                <p className="text-xs text-muted-foreground">Instagram, Telegram, VK, Facebook, YouTube и другие — всё из одного места</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <LayoutDashboard className="h-5 w-5 mt-0.5 text-orange-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">Аналитика и отчёты</p>
                <p className="text-xs text-muted-foreground">Следите за эффективностью контента и скачивайте отчёты в PDF/Excel</p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
            <div className="flex items-start gap-2">
              <BookOpen className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Рекомендуем начать с <strong>раздела обучения</strong> — там есть видео-инструкции по всем функциям платформы.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleClose}>
            Начать работу
          </Button>
          <Button onClick={handleGoToTutorials}>
            <BookOpen className="mr-2 h-4 w-4" />
            Перейти к обучению
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
