import React from 'react';
import { SocialPlatform } from '@/types';
import { SiInstagram, SiTelegram, SiVk, SiFacebook, SiYoutube, SiThreads } from 'react-icons/si';

interface SocialMediaIconProps {
  platform: SocialPlatform | string;
  className?: string;
}

export default function SocialMediaIcon({ platform, className = 'h-4 w-4' }: SocialMediaIconProps) {
  switch (platform) {
    case 'instagram':
      return <SiInstagram className={`text-pink-600 ${className}`} />;
    case 'telegram':
      return <SiTelegram className={`text-blue-500 ${className}`} />;
    case 'vk':
      return <SiVk className={`text-blue-600 ${className}`} />;
    case 'facebook':
      return <SiFacebook className={`text-indigo-600 ${className}`} />;
    case 'youtube':
      return <SiYoutube className={`text-red-600 ${className}`} />;
    case 'threads':
      return <SiThreads className={`text-black dark:text-white ${className}`} />;
    default:
      return null;
  }
}