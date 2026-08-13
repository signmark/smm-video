/**
 * task #84: red-before/green — все потребители профиля сведены на useUserProfile.
 *
 * Проверяет, что ни один live-потребитель `/api/user/profile` больше не создаёт
 * свой useQuery с ключом профиля, а читает единым useUserProfile. Мутация-пруф:
 * вернуть свой useQuery в любой потребитель → его строка упадет.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, rel), 'utf8');
}

const CONSUMERS: Array<[string, string]> = [
  ['Topbar', '../../components/AppShell/Topbar.tsx'],
  ['Content', '../../pages/content/index.tsx'],
  ['Campaign card', '../../pages/campaigns/[id].tsx'],
  ['ProfileDialog', '../../components/ProfileDialog.tsx'],
  ['usePlan', '../../hooks/use-plan.ts'],
  ['pricing', '../../pages/pricing.tsx'],
];

describe('task #84: все потребители профиля на useUserProfile', () => {
  for (const [name, rel] of CONSUMERS) {
    it(`${name}: не создаёт свой useQuery с ключом /api/user/profile`, () => {
      const src = read(rel);
      expect(src).toContain('useUserProfile');
      // Никто не должен держать свой useQuery с полным ключом профиля
      // (['/api/user/profile', discriminator...]). Bare инвалидация
      // ['/api/user/profile'] остаётся законной.
      expect(src).not.toContain("queryKey: ['/api/user/profile',");
      expect(src).not.toContain('queryKey: ["/api/user/profile",');
    });
  }
});
