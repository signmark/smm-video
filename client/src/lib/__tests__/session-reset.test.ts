import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AI-79: после выхода из аккаунта черновики сторис не должны переживать сессию.
 *
 * Тест намеренно не поднимает jsdom (его в проекте нет): `sessionCoordinator`
 * работает через обычный EventTarget, а он есть в Node как глобальный. Поэтому
 * подменяем `window` минимальным EventTarget — этого достаточно, чтобы событие
 * реально прошло через ту же подписку, что и в браузере.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  (globalThis as any).window = new EventTarget();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  delete (globalThis as any).window;
});

async function loadModules() {
  const { registerSessionReset } = await import('../session-reset');
  const { emitSessionEvent } = await import('../sessionCoordinator');
  const { useStoryStore } = await import('../storyStore');
  const { useSimpleStoryStore } = await import('../simpleStoryStore');
  return { registerSessionReset, emitSessionEvent, useStoryStore, useSimpleStoryStore };
}

function fillStores(useStoryStore: any, useSimpleStoryStore: any) {
  useStoryStore.setState({
    slides: [{ id: 'slide-1', elements: [{ id: 'el-1', type: 'text' }] }],
    storyTitle: 'Черновик прошлого пользователя',
    currentSlideIndex: 3,
    selectedElement: { id: 'el-1' },
  });
  useSimpleStoryStore.setState({
    slides: [{ id: 'simple-1', elements: [] }],
    storyTitle: 'Второй черновик',
    currentSlideIndex: 2,
    selectedElement: { id: 'simple-1' },
  });
}

describe('AI-79: выход из аккаунта чистит черновики сторис', () => {
  it('на account-changed оба стора теряют данные предыдущего пользователя', async () => {
    const { registerSessionReset, emitSessionEvent, useStoryStore, useSimpleStoryStore } = await loadModules();
    cleanup = registerSessionReset();

    fillStores(useStoryStore, useSimpleStoryStore);
    // Предусловие: без него тест зелёный на пустых сторах и не проверяет ничего.
    expect(useStoryStore.getState().storyTitle).toBe('Черновик прошлого пользователя');
    expect(useSimpleStoryStore.getState().slides).toHaveLength(1);

    emitSessionEvent('account-changed');

    expect(useStoryStore.getState().storyTitle).toBe('');
    expect(useStoryStore.getState().currentSlideIndex).toBe(0);
    expect(useStoryStore.getState().selectedElement).toBeNull();
    // resetStore() создаёт чистый первый слайд — «пусто» здесь значит «без чужих элементов».
    expect(useStoryStore.getState().slides.flatMap((s: any) => s.elements ?? [])).toHaveLength(0);

    expect(useSimpleStoryStore.getState().slides).toHaveLength(0);
    expect(useSimpleStoryStore.getState().storyTitle).toBe('');
    expect(useSimpleStoryStore.getState().currentSlideIndex).toBe(0);
    expect(useSimpleStoryStore.getState().selectedElement).toBeNull();
  });

  it('на invalid черновики НЕ трогаются: это может быть неудачное обновление токена у живого пользователя', async () => {
    const { registerSessionReset, emitSessionEvent, useStoryStore, useSimpleStoryStore } = await loadModules();
    cleanup = registerSessionReset();

    fillStores(useStoryStore, useSimpleStoryStore);
    emitSessionEvent('invalid');

    expect(useStoryStore.getState().storyTitle).toBe('Черновик прошлого пользователя');
    expect(useSimpleStoryStore.getState().slides).toHaveLength(1);
  });

  it('после отписки событие больше ничего не сбрасывает', async () => {
    const { registerSessionReset, emitSessionEvent, useStoryStore, useSimpleStoryStore } = await loadModules();
    const unsubscribe = registerSessionReset();
    unsubscribe();

    fillStores(useStoryStore, useSimpleStoryStore);
    emitSessionEvent('account-changed');

    expect(useStoryStore.getState().storyTitle).toBe('Черновик прошлого пользователя');
    expect(useSimpleStoryStore.getState().slides).toHaveLength(1);
  });
});

/**
 * Сама подписка бесполезна, если её никто не включает. Без этой проверки можно
 * удалить вызов из App.tsx, и все тесты выше останутся зелёными — ровно тот
 * случай «код есть, вызовов ноль», на котором мы уже обжигались.
 */
describe('AI-79: сброс подключён к точке старта приложения', () => {
  it('App.tsx импортирует и вызывает registerSessionReset', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8');
    expect(app).toContain("from \"@/lib/session-reset\"");
    expect(app).toMatch(/registerSessionReset\(\)/);
  });
});
