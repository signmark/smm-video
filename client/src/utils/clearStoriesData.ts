/**
 * Утилита для полной очистки данных Stories
 * Решает проблему с загрузкой старых неправильных данных
 */

export const clearAllStoriesData = () => {
  // Очищаем sessionStorage
  Object.keys(sessionStorage).forEach(key => {
    if (key.startsWith('story-') || key.includes('story')) {
      sessionStorage.removeItem(key);
      console.log('[Stories] Cleared sessionStorage:', key);
    }
  });

  // Очищаем localStorage для Stories
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('story-') || key.includes('story')) {
      localStorage.removeItem(key);
      console.log('[Stories] Cleared localStorage:', key);
    }
  });

  console.log('[Stories] All Stories data cleared');
};

export const forceCreateNewStory = async (campaignId: string) => {
  // Полная очистка
  clearAllStoriesData();
  
  console.log('[Stories] Force creating completely new Story');
  
  // Создаем новую Story с уникальным названием
  const timestamp = Date.now();
  const uniqueTitle = `Новая история ${timestamp}`;
  
  const response = await fetch('/api/stories/simple', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    },
    body: JSON.stringify({
      campaignId,
      title: uniqueTitle,
      type: 'story'
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to create new story');
  }
  
  const result = await response.json();
  console.log('[Stories] New Story created:', result.data.id);
  
  return result.data;
};