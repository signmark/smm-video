import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, MoreHorizontal, Pencil, Settings, Trash, Eye, Calendar, Activity, ChevronRight, FileText, ExternalLink, BookOpen, Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { serverDate } from '@/lib/date-utils';
interface UserCampaign {
  id: string;
  name?: string;
  description?: string;
  createdAt?: string;
  autonomous_settings?: any;
  is_assistant_active?: boolean;
}

interface CampaignsTableProps {
  campaigns: UserCampaign[];
  isLoading: boolean;
  onCreateNew: () => void;
  onManage: (campaign: UserCampaign) => void;
  onEdit: (campaign: UserCampaign) => void;
  onSettings: (campaign: UserCampaign) => void;
  onDelete: (campaign: UserCampaign) => void;
}

function CampaignsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-6 w-[140px] bg-muted animate-pulse rounded" />
              <div className="h-8 w-8 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="h-4 w-4 bg-muted animate-pulse rounded" />
              <div className="h-4 w-[100px] bg-muted animate-pulse rounded" />
            </div>
            <div className="flex space-x-2">
              <div className="h-9 w-[100px] bg-muted animate-pulse rounded" />
              <div className="h-9 w-[80px] bg-muted animate-pulse rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  const { t } = useTranslation();
  
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-300px)]">
      <div className="text-center max-w-2xl px-6">
        <FileText className="h-20 w-20 mx-auto mb-6 text-muted-foreground/50" />
        <h1 className="text-2xl font-bold mb-3">Добро пожаловать в SMM Manager!</h1>
        <p className="text-muted-foreground mb-8 text-base">
          SMM Manager — это платформа для управления публикациями в социальных сетях с поддержкой AI-генерации контента.
        </p>
        
        <div className="text-left bg-muted/30 p-6 rounded-lg mb-8 space-y-3">
          <p className="font-semibold text-foreground text-base mb-4">Для начала работы:</p>
          <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground ml-2">
            <li>
              Создайте <strong className="text-foreground">кампанию</strong> — это проект для управления контентом одного бренда или темы
            </li>
            <li>
              Настройте <strong className="text-foreground">социальные сети</strong> — подключите Instagram, Facebook, VK, Telegram или YouTube
            </li>
            <li>
              Добавьте <strong className="text-foreground">анкету бизнеса</strong> — AI будет генерировать контент на основе ваших данных
            </li>
            <li>
              Создавайте контент с помощью AI или вручную и публикуйте по расписанию
            </li>
          </ol>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Button onClick={onCreateNew} size="lg" data-testid="button-open-create-campaign-dialog">
            <Plus className="mr-2 h-5 w-5" />
            Создать кампанию
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a 
              href="https://smm.omemo.tech/help/tutorials" 
              target="_blank" 
              rel="noopener noreferrer"
              className="gap-2"
            >
              <BookOpen className="h-5 w-5" />
              Видеоуроки
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CampaignsGrid({
  campaigns,
  isLoading,
  onCreateNew,
  onManage,
  onEdit,
  onSettings,
  onDelete
}: CampaignsTableProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  // Фильтрация кампаний по поисковому запросу
  const filteredCampaigns = campaigns.filter(campaign => {
    const query = searchQuery.toLowerCase();
    return (
      campaign.name?.toLowerCase().includes(query) ||
      campaign.description?.toLowerCase().includes(query)
    );
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex justify-between items-center">
          <div className="h-8 w-[120px] bg-muted animate-pulse rounded" />
          <div className="h-10 w-[140px] bg-muted animate-pulse rounded" />
        </div>
        
        {/* Search skeleton */}
        <div className="h-10 w-full max-w-sm bg-muted animate-pulse rounded" />
        
        {/* Table skeleton */}
        <CampaignsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('campaigns.title')}</h1>
        <Button onClick={onCreateNew} data-testid="button-open-create-campaign-dialog">
          <Plus className="mr-2 h-4 w-4" />
          {t('campaigns.create')}
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState onCreateNew={onCreateNew} />
      ) : (
        <>
          {/* Search */}
          <div className="flex items-center justify-between">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('common.search') + '...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-campaigns"
                className="pl-10"
              />
            </div>
            {searchQuery && (
              <Badge variant="secondary" className="text-xs">
                {filteredCampaigns.length} {t('common.of')} {campaigns.length}
              </Badge>
            )}
          </div>

          {filteredCampaigns.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto bg-muted rounded-full w-12 h-12 flex items-center justify-center mb-4">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {searchQuery ? t('campaigns.notFound') : t('campaigns.empty')}
              </h3>
              <p className="text-muted-foreground">
                {searchQuery 
                  ? t('campaigns.tryDifferentSearch')
                  : t('campaigns.emptyDescription')
                }
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredCampaigns.map((campaign) => {
                const isAssistantActive = !!campaign.is_assistant_active;
                return (
                <Card 
                  key={campaign.id} 
                  className="group hover:shadow-md transition-all duration-200 hover:border-primary/20 cursor-pointer relative"
                  data-testid={`card-campaign-${campaign.id}`}
                  onClick={() => onManage(campaign)}
                >
                  {isAssistantActive && (
                    <div
                      className="absolute top-3 right-10 z-10"
                      title="Автономный ассистент активен"
                    >
                      <div className="flex items-center gap-1 bg-green-500/15 border border-green-500/30 rounded-full px-2 py-0.5">
                        <Bot className="h-3.5 w-3.5 text-green-500" />
                        <span className="text-[10px] font-medium text-green-600 dark:text-green-400">AI</span>
                      </div>
                    </div>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate text-foreground group-hover:text-primary transition-colors">
                          {campaign.name || t('campaigns.noName')}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {campaign.description || t('campaigns.noDescription')}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            data-testid={`button-actions-${campaign.id}`}
                            aria-label={t('campaigns.actionsMenuLabel', { name: campaign.name || t('campaigns.noName') })}
                            title={t('campaigns.actionsMenuLabel', { name: campaign.name || t('campaigns.noName') })}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[160px]">
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              onManage(campaign);
                            }}
                            data-testid={`action-manage-${campaign.id}`}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            {t('campaigns.manage')}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(campaign);
                            }}
                            data-testid={`action-edit-${campaign.id}`}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              onSettings(campaign);
                            }}
                            data-testid={`action-settings-${campaign.id}`}
                          >
                            <Settings className="mr-2 h-4 w-4" />
                            {t('nav.settings')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(campaign);
                            }}
                            className="text-destructive focus:text-destructive"
                            data-testid={`action-delete-${campaign.id}`}
                          >
                            <Trash className="mr-2 h-4 w-4" />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {campaign.createdAt 
                            ? formatDistanceToNow(serverDate(campaign.createdAt), { 
                                addSuffix: true, 
                                locale: ru 
                              })
                            : t('common.recently')
                          }
                        </span>
                      </div>
                      
                      <div className="flex items-center space-x-1">
                        <Activity className="h-3 w-3 text-green-500" />
                        <Badge variant="secondary" className="text-xs px-2 py-0.5">
                          {t('campaigns.status.active')}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                      <div className="flex space-x-2">
                        <Button 
                          variant="secondary" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onManage(campaign);
                          }}
                          className="h-8 px-3 text-xs"
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          {t('campaigns.open')}
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSettings(campaign);
                          }}
                          className="h-8 px-3 text-xs"
                        >
                          <Settings className="mr-1 h-3 w-3" />
                          {t('nav.settings')}
                        </Button>
                      </div>
                      
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}