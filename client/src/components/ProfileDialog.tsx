import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { User, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuthStore } from "@/lib/store";

interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_smm_admin: boolean;
}

interface ProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileDialog({ isOpen, onClose }: ProfileDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Получаем userId и token из store
  const userId = useAuthStore((state) => state.userId);
  const token = useAuthStore((state) => state.token);
  
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    new_password: ""
  });

  // Загружаем профиль пользователя — enabled только когда диалог открыт и есть токен
  const { data: userProfile, isLoading, refetch } = useQuery<UserProfile>({
    queryKey: ['/api/user/profile', userId || 'me'],
    enabled: isOpen && !!token,
    staleTime: 0,
    refetchOnMount: true,
  });

  // При открытии диалога всегда перезапрашиваем актуальные данные
  useEffect(() => {
    if (isOpen && token) {
      refetch();
    }
  }, [isOpen, token]);

  // Обновляем форму при загрузке профиля
  useEffect(() => {
    if (userProfile) {
      setFormData(prev => ({
        ...prev,
        first_name: userProfile.first_name || "",
        last_name: userProfile.last_name || "",
        email: userProfile.email || ""
      }));
    }
  }, [userProfile]);

  // Мутация для обновления профиля
  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest('/api/user/profile', {
        method: 'PUT',
        data
      });
    },
    onSuccess: () => {
      toast({
        title: `✅ ${t('profile.updated')}`,
        description: t('profile.updateSuccess')
      });
      // Инвалидируем кеш профиля с правильным ключом
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: `❌ ${t('common.error')}`,
        description: error.message || t('profile.updateError'),
        variant: "destructive"
      });
    }
  });

  const handleSave = () => {
    if (!formData.first_name.trim() || !formData.email.trim()) {
      toast({
        title: `❌ ${t('common.error')}`,
        description: t('profile.validationError'),
        variant: "destructive"
      });
      return;
    }

    const updateData: any = {
      first_name: formData.first_name.trim(),
      last_name: formData.last_name.trim(),
      email: formData.email.trim()
    };

    // Добавляем пароль только если он заполнен
    if (formData.new_password.trim()) {
      if (formData.new_password.length < 6) {
        toast({
          title: `❌ ${t('common.error')}`,
          description: t('profile.passwordLengthError'),
          variant: "destructive"
        });
        return;
      }
      updateData.new_password = formData.new_password;
    }

    updateProfileMutation.mutate(updateData);
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t('profile.title')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">{t('profile.loading')}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('profile.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="first_name">{t('profile.firstName')}</Label>
              <Input
                id="first_name"
                data-testid="input-first-name"
                value={formData.first_name}
                onChange={(e) => handleInputChange('first_name', e.target.value)}
                placeholder={t('profile.namePlaceholder')}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="last_name">{t('profile.lastName')}</Label>
              <Input
                id="last_name"
                data-testid="input-last-name"
                value={formData.last_name}
                onChange={(e) => handleInputChange('last_name', e.target.value)}
                placeholder={t('profile.lastNamePlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t('profile.email')}</Label>
            <Input
              id="email"
              data-testid="input-email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              placeholder="email@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new_password">{t('profile.newPassword')}</Label>
            <Input
              id="new_password"
              data-testid="input-new-password"
              type="password"
              value={formData.new_password}
              onChange={(e) => handleInputChange('new_password', e.target.value)}
              placeholder={t('profile.passwordPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            data-testid="button-close-profile"
          >
            {t('profile.cancel')}
          </Button>
          <Button 
            onClick={handleSave}
            disabled={updateProfileMutation.isPending}
            data-testid="button-save-profile"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateProfileMutation.isPending ? t('profile.saving') : t('profile.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}