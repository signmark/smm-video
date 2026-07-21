import { decodeJwtPayload } from './jwt';

export type SessionEvent = 'refreshed' | 'invalid' | 'unavailable' | 'account-changed';
export interface SessionSnapshot { sessionId: string | null; userId: string | null; token: string | null }

const SESSION_ID_KEY = 'auth_session_id';
const EVENT_NAME = 'smm-auth-session';

function newSessionId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function rotateSessionId(): string {
  const id = newSessionId();
  localStorage.setItem(SESSION_ID_KEY, id);
  return id;
}

export function clearSessionId(): void {
  localStorage.removeItem(SESSION_ID_KEY);
}

export function ensureSessionId(): string {
  return localStorage.getItem(SESSION_ID_KEY) || rotateSessionId();
}

export function getSessionSnapshot(): SessionSnapshot {
  const token = localStorage.getItem('auth_token');
  const userId = localStorage.getItem('user_id') || (token ? decodeJwtPayload(token)?.id || null : null);
  const sessionId = token && userId ? ensureSessionId() : localStorage.getItem(SESSION_ID_KEY);
  return {
    sessionId,
    userId,
    token,
  };
}

export function isSameSession(snapshot: SessionSnapshot): boolean {
  const current = getSessionSnapshot();
  return current.sessionId === snapshot.sessionId && current.userId === snapshot.userId;
}

export function emitSessionEvent(status: SessionEvent): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { status } }));
}

export function subscribeToSessionEvents(listener: (status: SessionEvent) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent).detail.status);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
