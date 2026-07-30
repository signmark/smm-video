import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Функция для получения читаемого названия сервиса по его внутреннему идентификатору
export function getServiceDisplayName(serviceName: string): string {
  const serviceNames: Record<string, string> = {
    'perplexity': 'Perplexity',
    'apify': 'Apify',
    'deepseek': 'DeepSeek',
    'fal_ai': 'FAL.AI',
    'claude': 'Claude AI',
    'gemini': 'Google Gemini',
    'qwen': 'Alibaba Qwen',
    'social_searcher': 'Social Searcher'
  };
  
  return serviceNames[serviceName] || serviceName;
}

/**
 * Преобразует строку из snake_case в camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Преобразует строку из camelCase в snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Рекурсивно преобразует все ключи объекта из snake_case в camelCase
 */
export function keysToCamel<T = any>(obj: any): T {
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => keysToCamel(item)) as any;
  }
  
  if (typeof obj === 'object' && obj.constructor === Object) {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = snakeToCamel(key);
      acc[camelKey] = keysToCamel(obj[key]);
      return acc;
    }, {} as any);
  }
  
  return obj;
}

/**
 * Рекурсивно преобразует все ключи объекта из camelCase в snake_case
 */
export function keysToSnake<T = any>(obj: any): T {
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => keysToSnake(item)) as any;
  }
  
  if (typeof obj === 'object' && obj.constructor === Object) {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = camelToSnake(key);
      acc[snakeKey] = keysToSnake(obj[key]);
      return acc;
    }, {} as any);
  }
  
  return obj;
}
