import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FeatureFlags } from '@shared/feature-flags';

// Hook for accessing feature flags in React components
export const useFeatureFlags = () => {
  const { data: featureFlags, isLoading } = useQuery<FeatureFlags>({
    queryKey: ['/api/feature-flags'],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });

  const defaultFlags: FeatureFlags = {
    instagramStories: false,
    videoEditor: false,
    aiImageGeneration: false,
    youtubePublishing: false,
    instagramPublishing: false,
    telegramPublishing: false,
    sentimentAnalysis: false,
    trendsAnalysis: false,
    commentCollection: false,
    automatedPosting: false,
    schedulerAdvanced: false,
    multiCampaignManagement: false,
  };

  return {
    featureFlags: featureFlags || defaultFlags,
    isLoading,
    
    // Helper functions for common checks
    isEnabled: (feature: keyof FeatureFlags): boolean => {
      return Boolean((featureFlags || defaultFlags)[feature]);
    },
    
    isDisabled: (feature: keyof FeatureFlags): boolean => {
      return !Boolean((featureFlags || defaultFlags)[feature]);
    },
  };
};

// Higher-order component for conditional feature rendering
interface FeatureGateProps {
  feature: keyof FeatureFlags;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  loadingComponent?: React.ReactNode;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({ 
  feature, 
  children, 
  fallback = null,
  loadingComponent = null 
}) => {
  const { isEnabled, isLoading } = useFeatureFlags();
  
  if (isLoading) {
    return loadingComponent as React.ReactElement;
  }
  
  if (!isEnabled(feature)) {
    return fallback as React.ReactElement;
  }
  
  return children as React.ReactElement;
};

// Export interface for external components to create disabled messages
export interface FeatureDisabledProps {
  featureName: string;
  message?: string;
}