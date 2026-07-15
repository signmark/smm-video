import { describe, expect, it } from 'vitest';
import {
  cleanGeneratedSocialContent,
  getGeneratedSocialContentRules,
} from '../utils/generated-social-content';

describe('generated social content cleanup', () => {
  it('cleans the exact DeepSeek VK artifact pattern reported by testers', () => {
    const raw = `Вот вариант поста для ВКонтакте, адаптированный под вашу ЦА и стиль фитнес-клуба. Текст разбит на логичные блоки для удобства чтения в ленте.
*
Заголовок: 🔥 3 правила, которые спасут вашу спину

✅ Правило 90 градусов
Держите колени под прямым углом.

📌 Запись по ссылке в профиле.

#фитнес #здоровьеспины #советытренера`;

    expect(cleanGeneratedSocialContent(raw, 'vk')).toBe(`3 правила, которые спасут вашу спину

Правило 90 градусов
Держите колени под прямым углом.

Запись по ссылке в профиле.`);
  });

  it('preserves ordinary post text and paragraph breaks', () => {
    const raw = 'Три правила для здоровой спины\n\nПервое правило — чаще двигаться.';

    expect(cleanGeneratedSocialContent(raw, 'vk')).toBe(raw);
  });

  it('keeps platform decorations outside VK but removes model commentary', () => {
    const raw = 'Ниже вариант поста для Telegram.\n\n✅ Полезный совет\n\n#здоровье';

    expect(cleanGeneratedSocialContent(raw, 'telegram')).toBe('✅ Полезный совет\n\n#здоровье');
  });

  it('adds the strict plain-text contract for VK', () => {
    const rules = getGeneratedSocialContentRules('vk');

    expect(rules).toContain('только готовый текст публикации');
    expect(rules).toContain('без эмодзи и хэштегов');
  });
});
