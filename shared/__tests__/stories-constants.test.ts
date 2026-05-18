/**
 * Unit tests for shared/stories-constants.ts
 * Тестирует константы и функции масштабирования Stories
 */

import { describe, it, expect } from 'vitest';
import {
  STORIES_PREVIEW_DIMENSIONS,
  INSTAGRAM_STORIES_DIMENSIONS,
  STORIES_SCALE_FACTORS,
  ADDITIONAL_MEDIA_TYPES,
  STORY_MEDIA_TYPES,
  getStoryMediaType,
  scaleCoordinatesToInstagram,
  scaleFontSizeToInstagram,
  scaleTextOverlayToInstagram,
  type TextOverlay,
} from '../stories-constants';

describe('shared/stories-constants', () => {
  describe('Константы размеров', () => {
    it('STORIES_PREVIEW_DIMENSIONS должны быть корректными', () => {
      expect(STORIES_PREVIEW_DIMENSIONS.WIDTH).toBe(350);
      expect(STORIES_PREVIEW_DIMENSIONS.HEIGHT).toBe(621);
    });

    it('INSTAGRAM_STORIES_DIMENSIONS должны соответствовать Instagram', () => {
      expect(INSTAGRAM_STORIES_DIMENSIONS.WIDTH).toBe(1080);
      expect(INSTAGRAM_STORIES_DIMENSIONS.HEIGHT).toBe(1920);
    });

    it('STORIES_SCALE_FACTORS должны вычисляться правильно', () => {
      expect(STORIES_SCALE_FACTORS.X).toBeCloseTo(1080 / 350, 2);
      expect(STORIES_SCALE_FACTORS.Y).toBeCloseTo(1920 / 621, 2);
    });
  });

  describe('getStoryMediaType', () => {
    it('должен возвращать VIDEO когда есть video_url и нет image_url', () => {
      expect(getStoryMediaType({ video_url: 'https://url', image_url: null })).toBe('video');
      expect(getStoryMediaType({ video_url: 'https://url', image_url: '' })).toBe('video');
    });

    it('должен возвращать IMAGE когда есть image_url', () => {
      expect(getStoryMediaType({ video_url: null, image_url: 'https://img' })).toBe('image');
      expect(getStoryMediaType({ video_url: 'https://v', image_url: 'https://img' })).toBe('image');
    });

    it('должен возвращать IMAGE когда оба null/undefined', () => {
      expect(getStoryMediaType({ video_url: null, image_url: null })).toBe('image');
      expect(getStoryMediaType({})).toBe('image');
    });
  });

  describe('scaleCoordinatesToInstagram', () => {
    it('должен масштабировать координаты', () => {
      const result = scaleCoordinatesToInstagram(100, 200);
      expect(result.x).toBe(Math.round(100 * STORIES_SCALE_FACTORS.X));
      expect(result.y).toBe(Math.round(200 * STORIES_SCALE_FACTORS.Y));
    });

    it('должен округлять результаты', () => {
      const result = scaleCoordinatesToInstagram(50, 50);
      expect(Number.isInteger(result.x)).toBe(true);
      expect(Number.isInteger(result.y)).toBe(true);
    });

    it('должен обрабатывать нулевые координаты', () => {
      const result = scaleCoordinatesToInstagram(0, 0);
      expect(result).toEqual({ x: 0, y: 0 });
    });
  });

  describe('scaleFontSizeToInstagram', () => {
    it('должен масштабировать размер шрифта', () => {
      const result = scaleFontSizeToInstagram(24);
      expect(result).toBe(Math.round(24 * STORIES_SCALE_FACTORS.X));
    });

    it('должен возвращать целое число', () => {
      const result = scaleFontSizeToInstagram(15);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('scaleTextOverlayToInstagram', () => {
    it('должен масштабировать overlay полностью', () => {
      const overlay: TextOverlay = {
        text: 'Test',
        x: 100,
        y: 200,
        fontSize: 20,
        color: '#000',
      };
      const result = scaleTextOverlayToInstagram(overlay);
      expect(result.text).toBe('Test');
      expect(result.x).toBe(Math.round(100 * STORIES_SCALE_FACTORS.X));
      expect(result.y).toBe(Math.round(200 * STORIES_SCALE_FACTORS.Y));
      expect(result.fontSize).toBe(Math.round(20 * STORIES_SCALE_FACTORS.X));
      expect(result.color).toBe('#000');
    });

    it('должен подставлять defaults для fontFamily, startTime, endTime', () => {
      const overlay: TextOverlay = {
        text: 'T',
        x: 0,
        y: 0,
        fontSize: 10,
        color: '#fff',
      };
      const result = scaleTextOverlayToInstagram(overlay);
      expect(result.fontFamily).toBe('Arial');
      expect(result.startTime).toBe(0);
      expect(result.endTime).toBe(60);
    });

    it('должен сохранять опциональные поля', () => {
      const overlay: TextOverlay = {
        text: 'T',
        x: 10,
        y: 10,
        fontSize: 12,
        color: '#000',
        fontFamily: 'Roboto',
        fontWeight: 'bold',
        startTime: 5,
        endTime: 30,
      };
      const result = scaleTextOverlayToInstagram(overlay);
      expect(result.fontFamily).toBe('Roboto');
      expect(result.startTime).toBe(5);
      expect(result.endTime).toBe(30);
    });
  });

  describe('ADDITIONAL_MEDIA_TYPES', () => {
    it('должен содержать ожидаемые типы', () => {
      expect(ADDITIONAL_MEDIA_TYPES.GENERATED_IMAGE).toBe('generated_image');
      expect(ADDITIONAL_MEDIA_TYPES.GENERATED_VIDEO).toBe('generated_video');
      expect(ADDITIONAL_MEDIA_TYPES.INSTAGRAM_READY_IMAGE).toBe('instagram_ready_image');
      expect(ADDITIONAL_MEDIA_TYPES.UPLOADED_VIDEO).toBe('uploaded_video');
    });
  });

  describe('STORY_MEDIA_TYPES', () => {
    it('должен содержать image и video', () => {
      expect(STORY_MEDIA_TYPES.IMAGE).toBe('image');
      expect(STORY_MEDIA_TYPES.VIDEO).toBe('video');
    });
  });
});
