import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Search, Instagram, MessageCircle, Users, Video, Facebook } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SourceCollectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
}

export function SourceCollectionDialog({ isOpen, onClose, campaignId }: SourceCollectionDialogProps) {
  const { toast } = useToast();
  const [selectedPlatforms, setSelectedPlatforms] = useState({
    instagram: true,
    telegram: true,
    vk: true,
    facebook: false,
    youtube: false
  });
  const [isCollecting, setIsCollecting] = useState(false);

  const platforms = [
    { id: 'instagram', name: 'Instagram', icon: Instagram, enabled: true },
    { id: 'telegram', name: 'Telegram', icon: MessageCircle, enabled: true },
    { id: 'vk', name: 'ВКонтакте', icon: Users, enabled: true },
    { id: 'facebook', name: 'Facebook', icon: Facebook, enabled: false },
    { id: 'youtube', name: 'YouTube', icon: Video, enabled: false }
  ];

  const handlePlatformChange = (platformId: string, checked: boolean) => {
    setSelectedPlatforms(prev => ({
      ...prev,
      [platformId]: checked
    }));
  };

  const handleStartCollection = async () => {
    const activePlatforms = Object.entries(selectedPlatforms)
      .filter(([_, enabled]) => enabled)
      .map(([platform, _]) => platform);

    if (activePlatforms.length === 0) {
      toast({
        title: "Ошибка",
        description: "Выберите хотя бы одну социальную сеть",
        variant: "destructive"
      });
      return;
    }

    setIsCollecting(true);

    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error("Требуется авторизация");
      }

      const response = await fetch('/api/trends/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          campaignId,
          platforms: activePlatforms,
          collectSources: true,
          collectComments: []
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Ошибка сбора источников');
      }

      toast({
        title: "Сбор источников запущен",
        description: "Новые источники будут добавлены автоматически",
      });

      onClose();
    } catch (error) {
      toast({
        title: "Ошибка сбора источников",
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
        variant: "destructive"
      });
    } finally {
      setIsCollecting(false);
    }
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Выберите социальные сети для сбора трендов</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Платформы для сбора трендов/источников:
          </p>
          
          <div className="space-y-3">
            {platforms.map((platform) => {
              const IconComponent = platform.icon;
              return (
                <div
                  key={platform.id}
                  className={`flex items-center space-x-3 p-2 rounded-lg border ${
                    platform.enabled 
                      ? 'bg-white hover:bg-gray-50' 
                      : 'bg-gray-50 opacity-50'
                  }`}
                >
                  <Checkbox
                    id={platform.id}
                    checked={selectedPlatforms[platform.id as keyof typeof selectedPlatforms]}
                    onCheckedChange={(checked) => 
                      platform.enabled && handlePlatformChange(platform.id, checked as boolean)
                    }
                    disabled={!platform.enabled}
                  />
                  <IconComponent className="h-5 w-5 text-blue-600" />
                  <label
                    htmlFor={platform.id}
                    className={`text-sm font-medium cursor-pointer flex-1 ${
                      platform.enabled ? 'text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    {platform.name}
                  </label>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isCollecting}>
              Отмена
            </Button>
            <Button onClick={handleStartCollection} disabled={isCollecting}>
              {isCollecting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Сбор...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Начать сбор
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}