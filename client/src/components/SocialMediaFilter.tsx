import React, { useState } from 'react';
import { SocialPlatform } from '@/types';
import { SiInstagram, SiTelegram, SiVk, SiFacebook, SiYoutube } from 'react-icons/si';

interface SocialMediaFilterProps {
  onFilterChange: (selected: SocialPlatform[]) => void;
  initialSelected?: SocialPlatform[];
  showCounts?: boolean;
  platformCounts?: Record<SocialPlatform, number>;
  className?: string;
}

export default function SocialMediaFilter({
  onFilterChange,
  initialSelected = [],
  showCounts = false,
  platformCounts = {} as Record<SocialPlatform, number>,
  className = ''
}: SocialMediaFilterProps) {
  const [selected, setSelected] = useState<SocialPlatform[]>(initialSelected);

  const platforms = [
    {
      id: 'instagram' as SocialPlatform,
      name: 'Instagram',
      icon: SiInstagram,
      color: 'text-pink-600',
      bgColor: 'bg-pink-100',
      count: platformCounts.instagram || 0
    },
    {
      id: 'telegram' as SocialPlatform,
      name: 'Telegram',
      icon: SiTelegram,
      color: 'text-blue-500',
      bgColor: 'bg-blue-100',
      count: platformCounts.telegram || 0
    },
    {
      id: 'vk' as SocialPlatform,
      name: 'ВКонтакте',
      icon: SiVk,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      count: platformCounts.vk || 0
    },
    {
      id: 'facebook' as SocialPlatform,
      name: 'Facebook',
      icon: SiFacebook,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-100',
      count: platformCounts.facebook || 0
    },
    {
      id: 'youtube' as SocialPlatform,
      name: 'YouTube',
      icon: SiYoutube,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      count: platformCounts.youtube || 0
    }
  ];

  const handleToggle = (platform: SocialPlatform) => {
    const newSelected = selected.includes(platform)
      ? selected.filter(p => p !== platform)
      : [...selected, platform];
    
    setSelected(newSelected);
    onFilterChange(newSelected);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="text-sm text-muted-foreground mb-2">
        Фильтр по платформам
      </div>
      
      <div className="flex flex-wrap gap-2">
        {platforms.map(platform => (
          <button
            key={platform.id}
            onClick={() => handleToggle(platform.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-colors ${
              selected.includes(platform.id)
                ? `${platform.bgColor} ${platform.color} border-current`
                : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60'
            }`}
          >
            <platform.icon className={`h-4 w-4 ${selected.includes(platform.id) ? platform.color : ''}`} />
            <span>{platform.name}</span>
            {showCounts && (
              <span className={`ml-1 inline-flex items-center justify-center rounded-full text-xs font-medium 
                ${selected.includes(platform.id) ? 'bg-white/80' : 'bg-muted-foreground/20'} 
                w-5 h-5`}
              >
                {platform.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}