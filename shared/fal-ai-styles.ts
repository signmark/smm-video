/**
 * Константы для стилей FAL.AI, которые поддерживаются всеми моделями
 * (Schnell, SDXL, Flux, Juggernaut)
 */

// Основные стили, поддерживаемые большинством моделей
export const SUPPORTED_STYLES = [
  'photographic',  // Фотореалистичный стиль с высоким уровнем детализации
  'cinematic',     // Кинематографический стиль, как в фильмах
  'anime',         // Стиль аниме/манга
  'base',          // Базовый стиль без дополнительных эффектов
];

// Расширенные стили, которые могут поддерживаться не всеми моделями
export const EXTENDED_STYLES = [
  'isometric',     // Изометрический стиль
  'digital-art',   // Цифровое искусство
  'comic-book',    // Стиль комиксов
  'fantasy-art',   // Фэнтези искусство
  'line-art',      // Контурное искусство
  'lowpoly',       // Низкополигональный стиль
  'pixel-art',     // Пиксельная графика
  'texture',       // Текстурный стиль
  'oil-painting',  // Масляная живопись
  'watercolor',    // Акварельная живопись
];

// Объект с описаниями стилей для отображения в интерфейсе
export const STYLE_DESCRIPTIONS: { [key: string]: string } = {
  'photographic': 'Фотореалистичный стиль с высокой детализацией',
  'cinematic': 'Кинематографический стиль как в фильмах',
  'anime': 'Стиль японской анимации и манги',
  'base': 'Нейтральный стиль без специальных эффектов',
  'isometric': 'Изометрический стиль с псевдо-3D проекцией',
  'digital-art': 'Современное цифровое искусство',
  'comic-book': 'Стилизация под комиксы',
  'fantasy-art': 'Фэнтезийное искусство',
  'line-art': 'Контурный рисунок линиями',
  'lowpoly': 'Стиль с низкополигональной графикой',
  'pixel-art': 'Стилизованная пиксельная графика',
  'texture': 'Акцент на текстурах и материалах',
  'oil-painting': 'Стилизация под масляную живопись',
  'watercolor': 'Стилизация под акварельную живопись',
};

// Интерфейс для карты стилей модели
export interface ModelStyleMap {
  photographic: string;
  cinematic: string;
  anime: string;
  base: string;
  [key: string]: string; // Дополнительные стили, которые могут быть добавлены в будущем
}

// Интерфейс для карты стилей всех моделей
export interface ModelStyles {
  schnell: ModelStyleMap;
  flux: ModelStyleMap;
  juggernaut: ModelStyleMap;
  sdxl: ModelStyleMap;
  [key: string]: ModelStyleMap; // Дополнительные модели, которые могут быть добавлены в будущем
}

// Объект соответствия специальных стилей для разных моделей
// Некоторые модели могут иметь собственные названия для схожих стилей
export const MODEL_SPECIFIC_STYLES: ModelStyles = {
  'schnell': {
    'photographic': 'photographic',
    'cinematic': 'cinematic',
    'anime': 'anime',
    'base': 'base',
  },
  'flux': {
    'photographic': 'photographic',
    'cinematic': 'cinematic',
    'anime': 'anime',
    'base': 'base',
  },
  'juggernaut': {
    'photographic': 'photographic',
    'cinematic': 'cinematic',
    'anime': 'anime',
    'base': 'none', // В Juggernaut 'none' используется вместо 'base'
  },
  'sdxl': {
    'photographic': 'photographic',
    'cinematic': 'cinematic',
    'anime': 'anime', 
    'base': 'base',
  },
};

// Параметры форматов для удобного использования в интерфейсе
export const ASPECT_RATIOS = [
  {
    name: '1:1 (Квадрат)',
    width: 1024,
    height: 1024,
    ratio: '1:1',
  },
  {
    name: '4:3 (Альбомная)',
    width: 1024,
    height: 768,
    ratio: '4:3',
  },
  {
    name: '3:4 (Портретная)',
    width: 768,
    height: 1024,
    ratio: '3:4',
  },
  {
    name: '16:9 (Широкоэкранная)',
    width: 1024,
    height: 576,
    ratio: '16:9',
  },
  {
    name: '9:16 (Мобильная)',
    width: 576,
    height: 1024,
    ratio: '9:16',
  },
];
