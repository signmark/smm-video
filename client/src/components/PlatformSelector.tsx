import React from 'react';
import { SafeSocialPlatform } from '@/lib/social-platforms';
import { SiInstagram, SiTelegram, SiVk, SiFacebook, SiYoutube, SiThreads, SiTiktok } from 'react-icons/si';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PlatformSelectorProps {
  selectedPlatforms: Record<string, boolean>;
  onChange: (platform: SafeSocialPlatform, isSelected: boolean) => void;
  content?: {
    contentType?: string;
    imageUrl?: string;
    images?: string[];
    videoUrl?: string;
    additionalImages?: string[];
    additionalVideos?: string[];
  };
  connectedPlatforms?: Record<SafeSocialPlatform, boolean> | null;
}

export default function PlatformSelector({
  selectedPlatforms,
  onChange,
  content,
  connectedPlatforms
}: PlatformSelectorProps) {
  const platforms = [
    {
      id: 'instagram' as SafeSocialPlatform,
      name: 'Instagram',
      icon: SiInstagram,
      color: 'text-pink-600'
    },
    {
      id: 'telegram' as SafeSocialPlatform,
      name: 'Telegram',
      icon: SiTelegram,
      color: 'text-blue-500'
    },
    {
      id: 'vk' as SafeSocialPlatform,
      name: 'ВКонтакте',
      icon: SiVk,
      color: 'text-blue-600'
    },
    {
      id: 'facebook' as SafeSocialPlatform,
      name: 'Facebook',
      icon: SiFacebook,
      color: 'text-indigo-600'
    },
    {
      id: 'youtube' as SafeSocialPlatform,
      name: 'YouTube',
      icon: SiYoutube,
      color: 'text-red-600'
    },
    {
      id: 'threads' as SafeSocialPlatform,
      name: 'Threads',
      icon: SiThreads,
      color: 'text-gray-900 dark:text-white'
    }
  ];

  // Check if content has images or video — только по реальным URL, не по типу контента
  // (тип 'text-image' не гарантирует наличие картинки)
  const hasImages = content && (
    !!(content.imageUrl) || 
    !!(content.images && content.images.length > 0) ||
    !!(content as any).additionalImages?.length ||
    !!(content as any).videoUrl ||
    content.contentType === 'video'
  );

  // TikTok: тип "video" или наличие videoUrl
  const hasVideo = content?.contentType === 'video'
    || !!(content as any)?.videoUrl
    || !!(content as any)?.additionalVideos?.length;

  // Check if content is a Story
  const isStory = content?.contentType === 'story';
  
  // Check if content is a Clip/Shorts (short vertical video)
  // Расширенная проверка: clip, shorts, video_clip, short_video
  const isClip = content?.contentType === 'clip' 
    || content?.contentType === 'shorts' 
    || content?.contentType === 'video_clip'
    || content?.contentType === 'short_video';
  
  // Platforms that support Stories
  const storyPlatforms = ['instagram', 'vk'];
  
  // Platforms that support Clips/Shorts/Reels
  const clipPlatforms = ['instagram', 'vk', 'youtube'];

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-4">
        {platforms.map((platform) => {
          const isSelected = selectedPlatforms[platform.id] || false;
          
          // Platform-specific requirements
          let isDisabled = false;
          let tooltipMessage = '';
          
          // null = данные ещё не загружены, false = не подключено — в обоих случаях блокируем
          const isConnected = connectedPlatforms != null
            && (connectedPlatforms[platform.id as SafeSocialPlatform] ?? true);
          
          // For Stories - only show VK and Instagram
          if (isStory && !storyPlatforms.includes(platform.id)) {
            isDisabled = true;
            tooltipMessage = 'Stories поддерживаются только в Instagram и ВКонтакте';
          } else if (isClip && !clipPlatforms.includes(platform.id)) {
            // For Clips/Shorts/Reels - only show VK, YouTube and Instagram
            isDisabled = true;
            tooltipMessage = 'Клипы/Shorts/Reels поддерживаются только в Instagram, ВКонтакте и YouTube';
          } else if (!isConnected) {
            isDisabled = true;
            tooltipMessage = 'Не подключено. Настройте в настройках кампании.';
          } else if (platform.id === 'instagram' && !hasImages && !isStory && !isClip) {
            isDisabled = true;
            tooltipMessage = 'Instagram требует изображения или видео';
          } else if (platform.id === 'youtube' && !hasVideo) {
            isDisabled = true;
            tooltipMessage = 'YouTube доступен только для видео контента';
          }
          
          const platformComponent = (
            <div
              key={platform.id}
              className={`flex items-center gap-2 p-3 border rounded-md ${
                isDisabled
                  ? 'border-destructive/30 bg-destructive/5'
                  : isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-input'
              }`}
            >
              <Checkbox
                id={`platform-${platform.id}`}
                checked={isSelected}
                disabled={isDisabled && !isSelected}
                onCheckedChange={(checked) => {
                  if (!isDisabled || (isDisabled && isSelected)) {
                    onChange(platform.id, checked === true);
                  }
                }}
              />
              <div className="flex flex-col">
                <Label
                  htmlFor={`platform-${platform.id}`}
                  className={`flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <platform.icon className={`h-5 w-5 ${platform.color}`} />
                  <span>{platform.name}</span>
                </Label>
                {isDisabled && tooltipMessage && (
                  <span className="text-xs text-destructive mt-0.5 ml-7">{tooltipMessage}</span>
                )}
              </div>
            </div>
          );

          return platformComponent;
        })}
      </div>
    </TooltipProvider>
  );
}