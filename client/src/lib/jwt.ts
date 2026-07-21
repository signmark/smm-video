export interface JwtPayload {
  id?: string;
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
