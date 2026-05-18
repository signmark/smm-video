import { create } from 'zustand';

// Local interfaces for story state
interface StorySlide {
  id: string;
  order: number;
  duration: number;
  background: {
    type: 'color' | 'image' | 'video';
    value: string;
  };
  elements: StoryElement[];
}

interface StoryElement {
  id: string;
  type: 'text' | 'image' | 'video' | 'poll' | 'quiz';
  position: { x: number; y: number };
  rotation: number;
  zIndex: number;
  content: any;
  style?: any;
}

interface StoryState {
  slides: StorySlide[];
  currentSlideIndex: number;
  storyTitle: string;
  selectedElement: StoryElement | null;
  
  // Actions
  initializeSlides: () => void;
  resetStore: () => void; // Новый метод для полной очистки состояния
  setSlides: (slides: StorySlide[]) => void;
  setCurrentSlideIndex: (index: number) => void;
  setStoryTitle: (title: string) => void;
  setSelectedElement: (element: StoryElement | null) => void;
  addElement: (elementType: StoryElement['type']) => StoryElement;
  updateElement: (elementId: string, updates: Partial<StoryElement>) => void;
  deleteElement: (elementId: string) => void;
  addSlide: () => void;
  deleteSlide: (slideIndex: number) => void;
  updateSlide: (updates: Partial<StorySlide>) => void;
}

export const useStoryStore = create<StoryState>()((set, get) => ({
  slides: [],
  currentSlideIndex: 0,
  storyTitle: '',
  selectedElement: null,

  initializeSlides: () => {
    const { slides } = get();
    if (slides.length === 0) {
      set({
        slides: [
          {
            id: 'slide-1',
            order: 1,
            duration: 5,
            background: { type: 'color', value: '#6366f1' },
            elements: []
          }
        ],
        currentSlideIndex: 0
      });
    }
  },

  resetStore: () => {

    
    // Создаем новый чистый слайд с уникальным ID
    const initialSlide = {
      id: `slide-${Date.now()}`,
      order: 0,
      duration: 5,
      background: { type: 'color' as const, value: '#6366f1' },
      elements: []
    };
    
    // Устанавливаем полностью чистое состояние
    set({
      slides: [initialSlide],
      currentSlideIndex: 0,
      storyTitle: '',
      selectedElement: null
    });
    

  },

  setSlides: (slides) => {
    set({ slides });
  },

  setCurrentSlideIndex: (index) => set({ currentSlideIndex: index }),
  setStoryTitle: (title) => set({ storyTitle: title }),
  setSelectedElement: (element) => set({ selectedElement: element }),

  addElement: (elementType) => {
    const { slides, currentSlideIndex } = get();
    
    if (slides.length === 0) {
      return null;
    }
    
    const newElement: StoryElement = {
      id: `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: elementType,
      position: { x: 50, y: 50 },
      rotation: 0,
      zIndex: (slides[currentSlideIndex]?.elements?.length || 0) + 1,
      content: getDefaultContent(elementType),
      style: getDefaultStyle(elementType)
    };



    const newSlides = [...slides];
    const targetSlide = newSlides[currentSlideIndex];
    
    if (targetSlide) {
      const updatedSlide = {
        ...targetSlide,
        elements: [...(targetSlide.elements || []), newElement]
      };
      newSlides[currentSlideIndex] = updatedSlide;
      

      
      set({ 
        slides: newSlides,
        selectedElement: newElement
      });
    } else {

      return null;
    }

    return newElement;
  },

  updateElement: (elementId, updates) => {
    const { slides, currentSlideIndex } = get();
    const newSlides = [...slides];
    const currentSlideData = newSlides[currentSlideIndex];
    
    if (currentSlideData) {
      const updatedElements = currentSlideData.elements?.map(el => 
        el.id === elementId ? { ...el, ...updates } : el
      ) || [];
      
      newSlides[currentSlideIndex] = {
        ...currentSlideData,
        elements: updatedElements
      };
      

      
      set({ slides: newSlides });
    }
  },

  deleteElement: (elementId) => {
    const { slides, currentSlideIndex } = get();
    const newSlides = [...slides];
    const currentSlideData = newSlides[currentSlideIndex];
    
    if (currentSlideData) {
      newSlides[currentSlideIndex] = {
        ...currentSlideData,
        elements: currentSlideData.elements?.filter(el => el.id !== elementId) || []
      };
      
      set({ slides: newSlides });
    }
  },

  addSlide: () => {
    const { slides } = get();
    const newSlide: StorySlide = {
      id: `slide-${Date.now()}`,
      order: slides.length + 1,
      duration: 5,
      background: { type: 'color', value: '#6366f1' },
      elements: []
    };
    
    set({ 
      slides: [...slides, newSlide],
      currentSlideIndex: slides.length
    });
  },

  deleteSlide: (slideIndex) => {
    const { slides, currentSlideIndex } = get();
    if (slides.length <= 1) return;
    
    const newSlides = slides.filter((_, index) => index !== slideIndex);
    
    set({ 
      slides: newSlides,
      currentSlideIndex: Math.max(0, Math.min(slideIndex, newSlides.length - 1))
    });
  },

  updateSlide: (updates) => {
    const { slides, currentSlideIndex } = get();
    const newSlides = [...slides];
    newSlides[currentSlideIndex] = { ...newSlides[currentSlideIndex], ...updates };
    
    set({ slides: newSlides });
  }
}));

// Helper functions
function getDefaultContent(elementType: StoryElement['type']) {
  switch (elementType) {
    case 'text':
      return { text: 'Новый текст' };
    case 'image':
      return { url: '', alt: 'Изображение' };
    case 'video':
      return { url: '', thumbnail: '' };
    case 'poll':
      return { 
        question: 'Ваш вопрос?', 
        options: ['Вариант 1', 'Вариант 2', 'Вариант 3'] 
      };
    case 'quiz':
      return { 
        question: 'Вопрос викторины?', 
        options: ['Вариант 1', 'Вариант 2', 'Вариант 3', 'Вариант 4'], 
        correctAnswer: 0 
      };
    default:
      return {};
  }
}

function getDefaultStyle(elementType: StoryElement['type']) {
  switch (elementType) {
    case 'text':
      return {
        fontSize: 16,
        fontFamily: 'Arial',
        color: '#000000',
        fontWeight: 'normal',
        textAlign: 'center'
      };
    case 'image':
    case 'video':
      return {
        borderRadius: 8
      };
    case 'poll':
    case 'quiz':
      return {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: 12,
        padding: 16
      };
    default:
      return {};
  }
}