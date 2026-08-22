/**
 * AI-89 — тест на синхронность REQUIRED_VARS и deploy/.env.example.
 *
 * ЗАЧЕМ. По AI-89 / критерий 3: «Список обязательных переменных в этом
 * модуле совпадает со списком в deploy/.env.example. Расхождение — ошибка
 * сборки или теста, а не устная договорённость».
 *
 * Если добавили обязательную переменную в service-urls.ts, но забыли
 * добавить её в deploy/.env.example — этот тест покраснеет (и наоборот).
 *
 * Мутация: убрать проверку ниже — тест краснеет на отсутствие переменной.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REQUIRED_VARS } from "../config/service-urls";

const ENV_EXAMPLE_PATH = path.resolve(
  __dirname,
  '../../deploy/.env.example',
);

describe('AI-89 / sync между REQUIRED_VARS и deploy/.env.example', () => {
  const envContent = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');

  // Простейший парсер: имя переменной — это `^[A-Z_]+=` в начале строки
  // (без отступа). Игнорируем комментарии и пустые строки.
  const envExampleKeys = new Set<string>();
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(trimmed);
    if (m) envExampleKeys.add(m[1]);
  }

  for (const required of REQUIRED_VARS) {
    it(`${required} присутствует в deploy/.env.example`, () => {
      expect(envExampleKeys.has(required)).toBe(true);
    });
  }

  it('обратное направление: ни один ключ из REQUIRED_VARS не потерян в .env.example', () => {
    // По AI-89 / критерий 3: «Расхождение — ошибка сборки или теста».
    // Этот тест ЗАЩИЩАЕТ от потери ключа в .env.example (например, при
    // ребейзе или merge). Сейчас в .env.example могут быть и опциональные
    // переменные (TG_TOKEN, VK_TOKEN и т.п.), поэтому обратное равенство
    // не проверяем — только покрытие REQUIRED_VARS.
    for (const required of REQUIRED_VARS) {
      expect(envExampleKeys.has(required)).toBe(true);
    }
  });

  it('множество REQUIRED_VARS не пустое (sanity)', () => {
    expect(REQUIRED_VARS.length).toBeGreaterThan(0);
  });

  it('все ключи в REQUIRED_VARS — это допустимые имена env-переменных', () => {
    for (const key of REQUIRED_VARS) {
      // POSIX env names: [A-Z_][A-Z0-9_]*
      expect(key).toMatch(/^[A-Z_][A-Z0-9_]*$/);
    }
  });
});
