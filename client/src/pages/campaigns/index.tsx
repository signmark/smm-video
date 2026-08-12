import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCampaignsList } from "@/hooks/use-campaigns";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CampaignForm } from "@/components/CampaignForm";
import { CampaignsGrid } from "@/components/CampaignsTable";
import { useAuthStore } from "@/lib/store";
import { useCampaignStore } from "@/lib/campaignStore";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { DeleteCampaignConfirmDialog } from "@/components/DeleteCampaignConfirmDialog";
import { EditCampaignDialog } from "@/components/EditCampaignDialog";
import { WelcomeDialog } from "@/components/WelcomeDialog";

interface UserCampaign {
  id: string;
  name?: string;
  description?: string;
  createdAt?: string;
  autonomous_settings?: any;
  is_assistant_active?: boolean;
}

export default function Campaigns() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { userId } = useAuthStore();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  // Состояние для диалога подтверждения удаления кампании
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<{id: string, name: string} | null>(null);
  
  // Состояние для диалога редактирования кампании
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<{id: string; name: string} | null>(null);
  
  // Получаем функции для управления кампаниями  
  const { setSelectedCampaign } = useCampaignStore();
  
  // canonical shared hook, polling removed (invalidation after mutations)
  const { data: campaignsResponse, isLoading, error } = useCampaignsList();
  
  // Сортировка кампаний по дате создания (сначала новые)
  const sortedCampaigns = useMemo(() => {
    if (!campaignsResponse?.data) return [];
    
    return [...campaignsResponse.data].sort((a, b) => {
      // Сначала проверяем, есть ли поле createdAt у кампаний
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      
      // Сортируем по убыванию даты (новые сначала)
      return dateB - dateA;
    });
  }, [campaignsResponse?.data]);

  // Обработчики действий таблицы
  const handleManage = (campaign: UserCampaign) => {
    setSelectedCampaign(campaign.id, campaign.name || '');
    navigate(`/campaigns/${campaign.id}`);
  };

  const handleEdit = (campaign: UserCampaign) => {
    setEditingCampaign({id: campaign.id, name: campaign.name || ''});
    setEditDialogOpen(true);
  };

  const handleSettings = (campaign: UserCampaign) => {
    setEditingCampaign({id: campaign.id, name: campaign.name || ''});
    setEditDialogOpen(true);
  };

  const handleDelete = (campaign: UserCampaign) => {
    setCampaignToDelete({id: campaign.id, name: campaign.name || ''});
    setConfirmDialogOpen(true);
  };

  return (
    <>
      <WelcomeDialog />
      {error ? (
        <div className="p-4 mb-4 text-destructive bg-destructive/10 rounded-lg border">
          Ошибка загрузки: {(error as Error).message}
        </div>
      ) : null}
      
      <CampaignsGrid
        campaigns={sortedCampaigns}
        isLoading={isLoading}
        onCreateNew={() => setIsOpen(true)}
        onManage={handleManage}
        onEdit={handleEdit}
        onSettings={handleSettings}
        onDelete={handleDelete}
      />

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <CampaignForm onClose={() => setIsOpen(false)} />
        </DialogContent>
      </Dialog>

      <DeleteCampaignConfirmDialog 
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        campaign={campaignToDelete}
        onDelete={() => {
          setCampaignToDelete(null);
        }}
      />

      {editingCampaign && (
        <Dialog open={editDialogOpen} onOpenChange={() => {
          setEditDialogOpen(false);
          setEditingCampaign(null);
        }}>
          <EditCampaignDialog
            campaignId={editingCampaign.id}
            currentName={editingCampaign.name}
            onClose={() => {
              setEditDialogOpen(false);
              setEditingCampaign(null);
            }}
          />
        </Dialog>
      )}
    </>
  );
}