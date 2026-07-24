import { describe, it, expect } from 'vitest';
import { isWsAllowed } from '../utils/ws-gate';

// Security §5 regression: /ws закрыт в production (temp close до полноценной изоляции).
// См. docs/followups/2026-07-24-security-backlog.md §5.

describe('Security §5: WS gate', () => {
  it('production: /ws закрыт по умолчанию', () => {
    expect(isWsAllowed({ NODE_ENV: 'production' })).toBe(false);
  });

  it('production: закрыт при любых значениях флага, кроме точного "true"', () => {
    expect(isWsAllowed({ NODE_ENV: 'production', WS_PUBLIC_EVENTS_ENABLED: '1' })).toBe(false);
    expect(isWsAllowed({ NODE_ENV: 'production', WS_PUBLIC_EVENTS_ENABLED: 'TRUE' })).toBe(false);
    expect(isWsAllowed({ NODE_ENV: 'production', WS_PUBLIC_EVENTS_ENABLED: 'yes' })).toBe(false);
    expect(isWsAllowed({ NODE_ENV: 'production', WS_PUBLIC_EVENTS_ENABLED: '' })).toBe(false);
  });

  it('production: явный override WS_PUBLIC_EVENTS_ENABLED=true открывает', () => {
    expect(isWsAllowed({ NODE_ENV: 'production', WS_PUBLIC_EVENTS_ENABLED: 'true' })).toBe(true);
  });

  it('development/test: /ws открыт (Vite HMR и локальная разработка не страдают)', () => {
    expect(isWsAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(isWsAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(isWsAllowed({})).toBe(true);
  });
});
