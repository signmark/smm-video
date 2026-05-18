import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';

interface FacebookGroup {
  groupId: string;
  groupName: string;
  groupDescription: string;
  privacy: string;
  memberCount: number;
  cover: string;
  linkedPageId: string | null;
  linkedPageName: string;
  pageAccessToken: string | null;
  userAccessToken?: string;
}

interface FacebookGroupsSelectorProps {
  campaignId: string;
  accessToken: string;
  onGroupsSelected?: (groups: FacebookGroup[]) => void;
}

export default function FacebookGroupsSelector({ 
  campaignId, 
  accessToken, 
  onGroupsSelected 
}: FacebookGroupsSelectorProps) {
  const [groups, setGroups] = useState<FacebookGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const discoverGroups = async () => {
    setLoading(true);
    try {
      console.log('🔍 Начинаем обнаружение Facebook групп...');

      const response = await fetch(
        `/api/campaigns/${campaignId}/discover-facebook-groups?accessToken=${accessToken}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();
      console.log('📋 Ответ обнаружения групп:', data);

      if (response.ok && data.success) {
        setGroups(data.groups || []);
        
        toast({
          title: "Группы обнаружены",
          description: `Найдено ${data.totalGroups} Facebook групп`,
        });

        console.log(`✅ Обнаружено ${data.totalGroups} групп`);
      } else {
        toast({
          title: "Ошибка",
          description: data.error || "Не удалось обнаружить группы",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('❌ Ошибка обнаружения групп:', error);
      toast({
        title: "Ошибка сети",
        description: "Не удалось обнаружить Facebook группы",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleGroupSelection = (groupId: string) => {
    const newSelection = new Set(selectedGroups);
    if (newSelection.has(groupId)) {
      newSelection.delete(groupId);
    } else {
      newSelection.add(groupId);
    }
    setSelectedGroups(newSelection);
  };

  const saveSelectedGroups = async () => {
    if (selectedGroups.size === 0) {
      toast({
        title: "Выберите группы",
        description: "Пожалуйста, выберите хотя бы одну группу для сохранения",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const groupsToSave = groups.filter(group => selectedGroups.has(group.groupId));
      
      console.log(`💾 Сохраняем ${groupsToSave.length} выбранных групп...`);

      const response = await fetch(`/api/campaigns/${campaignId}/save-facebook-groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          selectedGroups: groupsToSave
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: "Группы сохранены",
          description: `Сохранено ${groupsToSave.length} Facebook групп`,
        });

        // Уведомляем родительский компонент
        onGroupsSelected?.(groupsToSave);

        console.log(`✅ Группы успешно сохранены`);
      } else {
        toast({
          title: "Ошибка сохранения",
          description: data.error || "Не удалось сохранить группы",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('❌ Ошибка сохранения групп:', error);
      toast({
        title: "Ошибка сети",
        description: "Не удалось сохранить группы",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const formatMemberCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const getPrivacyLabel = (privacy: string) => {
    const labels = {
      OPEN: 'Открытая',
      CLOSED: 'Закрытая',
      SECRET: 'Секретная'
    };
    return labels[privacy as keyof typeof labels] || privacy;
  };

  const getPrivacyColor = (privacy: string) => {
    const colors = {
      OPEN: 'bg-green-100 text-green-800',
      CLOSED: 'bg-yellow-100 text-yellow-800',
      SECRET: 'bg-red-100 text-red-800'
    };
    return colors[privacy as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Facebook Группы</h3>
        <Button 
          onClick={discoverGroups} 
          disabled={loading}
          className="flex items-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Поиск групп...
            </>
          ) : (
            <>
              🔍 Найти группы
            </>
          )}
        </Button>
      </div>

      {groups.length > 0 && (
        <>
          <div className="text-sm text-gray-600">
            Найдено {groups.length} групп. Выберите группы для автоматической публикации:
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {groups.map((group) => (
              <Card key={group.groupId} className="relative">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`group-${group.groupId}`}
                      checked={selectedGroups.has(group.groupId)}
                      onCheckedChange={() => toggleGroupSelection(group.groupId)}
                      className="mt-1"
                    />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900 truncate">
                            {group.groupName}
                          </h4>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                            {group.groupDescription || 'Описание не указано'}
                          </p>
                        </div>
                        
                        {group.cover && (
                          <img 
                            src={group.cover} 
                            alt={group.groupName}
                            className="w-12 h-12 rounded-md object-cover ml-3"
                          />
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 mt-3">
                        <Badge 
                          variant="secondary" 
                          className={getPrivacyColor(group.privacy)}
                        >
                          {getPrivacyLabel(group.privacy)}
                        </Badge>
                        
                        <Badge variant="outline">
                          {formatMemberCount(group.memberCount)} участников
                        </Badge>
                        
                        <Badge variant="outline">
                          {group.linkedPageName}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-gray-600">
              Выбрано: {selectedGroups.size} из {groups.length} групп
            </div>
            
            <Button 
              onClick={saveSelectedGroups} 
              disabled={saving || selectedGroups.size === 0}
              className="flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  💾 Сохранить группы
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {groups.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          <p>Нажмите "Найти группы" для обнаружения доступных Facebook групп</p>
        </div>
      )}
    </div>
  );
}