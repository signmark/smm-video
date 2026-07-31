/**
 * Память о свёрнутом меню.
 *
 * Главное здесь — не «сохраняется/читается», а то, что недоступное хранилище
 * не роняет приложение: инициализатор состояния вызывается при монтировании
 * AppShell, то есть исключение оттуда убило бы весь интерфейс ради настройки
 * меню.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../sidebar-preferences';

const realLocalStorage = globalThis.localStorage;

function useStorage(impl: Partial<Storage>) {
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true });
}

beforeEach(() => {
  const store = new Map<string, string>();
  useStorage({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage);
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: realLocalStorage, configurable: true });
});

describe('память о свёрнутом меню', () => {
  it('по умолчанию меню развёрнуто', () => {
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('свёрнутое состояние переживает переход между страницами', () => {
    writeSidebarCollapsed(true);
    expect(readSidebarCollapsed()).toBe(true);
  });

  it('развёрнутое состояние сохраняется явно, а не отсутствием ключа', () => {
    writeSidebarCollapsed(true);
    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('недоступное хранилище не роняет чтение (приватный режим, отключённые cookies)', () => {
    useStorage({
      getItem: () => {
        throw new DOMException('SecurityError');
      },
    } as unknown as Storage);

    expect(() => readSidebarCollapsed()).not.toThrow();
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('недоступное хранилище не роняет запись', () => {
    useStorage({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    } as unknown as Storage);

    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });
});
