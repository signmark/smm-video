import { create } from 'zustand';

// Простая архитектура Stories БЕЗ persist middleware и сложных флагов
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

interface SimpleStoryState {
  slides: StorySlide[];
  currentSlideIndex: number;
  storyTitle: string;
  selectedElement: StoryElement | null;
  
  // Простые действия без persist логики
  setSlides: (slides: StorySlide[]) => void;
  setCurrentSlideIndex: (index: number) => void;
  setStoryTitle: (title: string) => void;
  addElement: (elementType: 'text' | 'image' | 'video' | 'poll' | 'quiz') => StoryElement | null;
  updateElement: (elementId: string, updates: Partial<StoryElement>) => void;
  deleteElement: (elementId: string) => void;
  clearStore: () => void;
}

// Простой Store БЕЗ persist middleware
export const useSimpleStoryStore = create<SimpleStoryState>((set, get) => ({
  slides: [],
  currentSlideIndex: 0,
  storyTitle: '',
  selectedElement: null,

  setSlides: (slides) => set({ slides }),
  
  setCurrentSlideIndex: (index) => set({ currentSlideIndex: index }),
  
  setStoryTitle: (title) => set({ storyTitle: title }),

  addElement: (elementType) => {
    const { slides, currentSlideIndex } = get();
    
    if (slides.length === 0) {

      return null;
    }

    const newElement: StoryElement = {
      id: `element_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: elementType,
      position: { x: 50, y: 50 },
      rotation: 0,
      zIndex: Date.now(),
      content: elementType === 'text' ? 'Новый текст' : '',
      style: elementType === 'text' ? {
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#FFFFFF',
        textAlign: 'center'
      } : {}
    };

    const newSlides = [...slides];
    const targetSlide = newSlides[currentSlideIndex];
    
    if (targetSlide) {
      targetSlide.elements = [...(targetSlide.elements || []), newElement];
      set({ slides: newSlides, selectedElement: newElement });
      return newElement;
    }
    
    return null;
  },

  updateElement: (elementId, updates) => {
    const { slides, currentSlideIndex } = get();
    const newSlides = [...slides];
    const currentSlide = newSlides[currentSlideIndex];
    
    if (currentSlide) {
      currentSlide.elements = currentSlide.elements?.map(el => 
        el.id === elementId ? { ...el, ...updates } : el
      ) || [];
      
      set({ slides: newSlides });
    }
  },

  deleteElement: (elementId) => {
    const { slides, currentSlideIndex } = get();
    const newSlides = [...slides];
    const currentSlide = newSlides[currentSlideIndex];
    
    if (currentSlide) {
      currentSlide.elements = currentSlide.elements?.filter(el => el.id !== elementId) || [];
      set({ slides: newSlides, selectedElement: null });
    }
  },

  clearStore: () => set({
    slides: [],
    currentSlideIndex: 0,
    storyTitle: '',
    selectedElement: null
  })
}));