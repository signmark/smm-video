import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MOJIBAKE = /Ð|Ñ[\x80-\xBF]|Â|â(?:€|†)/u;

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('Topbar copy encoding', () => {
  // Подписи топбара переехали из JSX в локали, поэтому кириллицу теперь ищем
  // в ru.json, а проверку на битую кодировку оставляем на обоих файлах.
  it('keeps readable UTF-8 copy in the Russian locale', () => {
    const ru = read('../../locales/ru.json');

    expect(ru).toContain('Тарифы');
    expect(ru).toContain('СММ Админ');
    expect(ru).not.toMatch(MOJIBAKE);
  });

  it('has no mojibake markers in the Topbar component', () => {
    expect(read('../../components/AppShell/Topbar.tsx')).not.toMatch(MOJIBAKE);
  });
});
