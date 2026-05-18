import { z } from 'zod';

// TypeScript interfaces for frontend
export interface StoryContent {
  id: string;
  campaignId: string;
  userId: string;
  title: string;
  type: 'story';
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  scheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  slides: StorySlide[];
  platformSettings?: {
    instagram?: {
      duration: number;
      interactive_elements?: InteractiveElement[];
    };
  };
  metadata?: any;
}

export interface StorySlide {
  id: string;
  storyId: string;
  order: number;
  duration: number; // 1-15 seconds
  background: BackgroundConfig;
  elements: StoryElement[];
  animation?: AnimationConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryElement {
  id: string;
  slideId: string;
  type: 'text' | 'image' | 'video' | 'sticker' | 'poll' | 'question';
  position: { x: number; y: number; width: number; height: number };
  rotation: number;
  zIndex: number;
  content: any; // Varies by type
  style?: ElementStyle;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackgroundConfig {
  type: 'color' | 'gradient' | 'image' | 'video';
  value: string | GradientConfig | MediaConfig;
}

export interface GradientConfig {
  type: 'linear' | 'radial';
  colors: string[];
  angle?: number; // for linear gradients
  center?: { x: number; y: number }; // for radial gradients
}

export interface MediaConfig {
  url: string;
  fit: 'cover' | 'contain' | 'fill';
  position?: { x: number; y: number };
}

export interface ElementStyle {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
  borderRadius?: number;
  padding?: number;
  textShadow?: string;
  textStroke?: {
    width: number;
    color: string;
  };
}

export interface InteractiveElement {
  type: 'poll' | 'question' | 'location' | 'hashtag';
  position: { x: number; y: number };
  data: any;
}

export interface AnimationConfig {
  type: 'fade' | 'slide' | 'zoom' | 'rotate';
  duration: number;
  delay?: number;
  easing?: string;
}

// Zod schemas for validation (manually defined to remove drizzle dependency)
export const insertStoryContentSchema = z.object({
  id: z.string().uuid().optional(),
  campaignId: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  type: z.literal('story').default('story'),
  status: z.enum(['draft', 'scheduled', 'published', 'failed']).default('draft'),
  scheduledAt: z.date().optional().nullable(),
  platformSettings: z.any().optional(),
  metadata: z.any().optional(),
});

export const insertStorySlideSchema = z.object({
  id: z.string().uuid().optional(),
  storyId: z.string().uuid(),
  order: z.number().int(),
  duration: z.number().int().min(1).max(15).default(5),
  background: z.any(),
  animation: z.any().optional(),
});

export const insertStoryElementSchema = z.object({
  id: z.string().uuid().optional(),
  slideId: z.string().uuid(),
  type: z.string(),
  position: z.any(),
  rotation: z.string().optional().default('0'),
  zIndex: z.number().int().default(1),
  content: z.any(),
  style: z.any().optional(),
});

export type InsertStoryContent = z.infer<typeof insertStoryContentSchema>;
export type InsertStorySlide = z.infer<typeof insertStorySlideSchema>;
export type InsertStoryElement = z.infer<typeof insertStoryElementSchema>;

export type SelectStoryContent = StoryContent;
export type SelectStorySlide = StorySlide;
export type SelectStoryElement = StoryElement;
