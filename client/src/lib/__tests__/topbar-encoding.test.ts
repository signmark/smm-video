import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Topbar copy encoding', () => {
  it('contains readable UTF-8 copy and no common mojibake markers', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../components/AppShell/Topbar.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('Тарифы');
    expect(source).toContain('СММ Админ');
    expect(source).not.toMatch(/Ð|Ñ[\x80-\xBF]|Â|â(?:€|†)/u);
  });
});
