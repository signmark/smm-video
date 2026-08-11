/**
 * AI-99: версия npm закрепляется в манифесте.
 *
 * Проблема: лок собирается npm 11 (или иным), а в образе стоит npm 10.9.8 —
 * `npm ci` там падает. Чтобы установка была воспроизводимой, в package.json:
 *   - `packageManager`: `"npm@10.9.8"` — жёстко фиксирует npm для записи лока;
 *   - `engines.npm`: `~10.9.0` — разрешает патчи 10.9.x и отвергает 11.
 * engine-strict НЕ ставим (слишком жёстко — встанет колом при вливании у всех
 * на npm 11).
 *
 * Проверяем также согласованность: версия node из .nvmrc совпадает с базой
 * образа (Dockerfile закреплён по digest, см. AI-42).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
// AI-99: без декларации `semver` (TS7016) import из npm-модуля не проходит.
// @types/semver ставить нельзя — это правит package-lock.json, а лок в этой
// ветке трогать запрещено. Поэтому require с узким типом: компилятор проверяет
// имена методов, а не молчит про any.
const semver = require('semver') as {
  satisfies(version: string, range: string): boolean;
  major(version: string): number;
};

function readPackageJson(): Record<string, any> {
  return JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
}

/** Достаёт закреплённую версию node/npm из Dockerfile-комментария «node vX / npm Y».
 *  База закреплена по digest, поэтому число читается из комментария, а не из тега. */
function dockerfileNodeNpm(): { node: string; npm: string } {
  const dockerfile = readFileSync(resolve(__dirname, '../../Dockerfile'), 'utf-8');
  const m = dockerfile.match(/node v(\d+(?:\.\d+){1,2}) \/ npm (\d+(?:\.\d+){1,2})/);
  if (!m) throw new Error('Dockerfile: не найден комментарий "node vX / npm Y"');
  return { node: m[1], npm: m[2] };
}

describe('AI-99: npm version pinning', () => {
  const pkg = readPackageJson();
  const docker = dockerfileNodeNpm();

  it('packageManager указывает на npm 10.x', () => {
    expect(pkg.packageManager).toBeDefined();
    const m = /^npm@(\d+\.\d+\.\d+)/.exec(String(pkg.packageManager));
    expect(m).not.toBeNull();
    expect(semver.major(m![1])).toBe(10);
  });

  it('engines.npm пропускает 10.9.x', () => {
    const range = pkg.engines?.npm;
    expect(range).toBeDefined();
    expect(semver.satisfies('10.9.0', range)).toBe(true);
    expect(semver.satisfies('10.9.8', range)).toBe(true);
  });

  it('engines.npm отвергает npm 11', () => {
    const range = pkg.engines?.npm;
    expect(semver.satisfies('11.0.0', range)).toBe(false);
    expect(semver.satisfies('11.10.0', range)).toBe(false);
  });

  it('npm из Dockerfile попадает в диапазон engines.npm', () => {
    const range = pkg.engines?.npm;
    expect(semver.satisfies(docker.npm, range)).toBe(true);
  });

  it('node в .nvmrc совпадает с версией из Dockerfile', () => {
    const nvmrc = readFileSync(resolve(__dirname, '../../.nvmrc'), 'utf-8').trim();
    expect(nvmrc).toBe(docker.node);
  });
});
