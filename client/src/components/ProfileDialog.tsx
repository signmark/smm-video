import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { User, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuthStore } from "@/lib/store";
import { useUserProfile } from "@/hooks/use-user-profile";

interface ProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileDialog({ isOpen, onClose }: ProfileDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const token = useAuthStore((state) => state.token);
  
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    new_password: "",
    current_password: ""
  });

  // Профиль — единый каноник useUserProfile (task #84). Диалог не заводит свой
  // useQuery: присоединяется к общему кэшу профиля, а свежесть при открытии
  // обеспечивает явный refetch (см. useEffect ниже).
  const { data: userProfile, isLoading, refetch } = useUserProfile();

  // При открытии диалога всегда перезапрашиваем актуальные данные
  useEffect(() => {
    if (isOpen && token) {
      refetch();
    }
  }, [isOpen, token, refetch]);

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

  // Смена пароля и смена почты требуют подтверждения текущим паролем.
  // Поле показываем только когда оно действительно нужно, чтобы правка
  // одного лишь имени не спрашивала пароль.
  const emailChanged =
    !!userProfile &&
    formData.email.trim().toLowerCase() !== (userProfile.email || "").toLowerCase();
  const passwordChanged = formData.new_password.trim().length > 0;
  const requiresCurrentPassword = emailChanged || passwordChanged;

  // Мутация для обновления профиля
  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest('/api/user/profile', {
        method: 'PUT',
        data
      });
    },
    onSuccess: (result: any) => {
      // Почта меняется не сразу: сервер лишь отправил письмо со ссылкой.
      // Говорим об этом прямо, иначе пользователь решит, что адрес уже сменён.
      if (result?.email_change_pending) {
        toast({
          title: `📧 ${t('profile.emailConfirmTitle')}`,
          description: t('profile.emailConfirmSent', { email: result.pending_email })
        });
      } else {
        toast({
          title: `✅ ${t('profile.updated')}`,
          description: t('profile.updateSuccess')
        });
      }
      setFormData(prev => ({ ...prev, new_password: "", current_password: "" }));
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

    // Текущий пароль отправляем только когда сервер его потребует —
    // при смене пароля или почты.
    if (requiresCurrentPassword) {
      if (!formData.current_password.trim()) {
        toast({
          title: `❌ ${t('common.error')}`,
          description: t('profile.currentPasswordRequired'),
          variant: "destructive"
        });
        return;
      }
      updateData.current_password = formData.current_password;
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

          {requiresCurrentPassword && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
              <Label htmlFor="current_password">{t('profile.currentPassword')}</Label>
              <Input
                id="current_password"
                data-testid="input-current-password"
                type="password"
                autoComplete="current-password"
                value={formData.current_password}
                onChange={(e) => handleInputChange('current_password', e.target.value)}
                placeholder={t('profile.currentPasswordPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {emailChanged ? t('profile.currentPasswordHintEmail') : t('profile.currentPasswordHint')}
              </p>
            </div>
          )}
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