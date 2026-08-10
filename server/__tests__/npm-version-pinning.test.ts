/**
 * AI-99: проверка соответствия версии npm между package.json и Dockerfile.
 *
 * Почему: npm 10 и npm 11 разрешают дерево зависимостей по-разному.
 * Лок, сгенерированный npm 11, не собирается npm 10, а в Dockerfile
 * используется npm 10.9.8. Если package.json требует `>=10.0.0`,
 * разработчик на npm 11 генерирует лок, который упадёт в `docker build`.
 *
 * Тест проверяет:
 * 1. `engines.npm` в package.json совместим с версией в Dockerfile
 * 2. `packageManager` поле существует и указывает на npm 10.x
 * 3. Версия node в .nvmrc совпадает с node в Dockerfile
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function readPackageJson() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
}

function readDockerfile(): string {
  return readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
}

function readNvmrc(): string {
  return readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
}

describe('AI-99: npm version pinning', () => {
  it('packageManager field exists and specifies npm 10.x', () => {
    const pkg = readPackageJson();
    expect(pkg.packageManager).toBeDefined();
    expect(pkg.packageManager).toMatch(/^npm@10\./);
  });

  it('engines.npm allows npm 10.9.x (Dockerfile version)', () => {
    const pkg = readPackageJson();
    const engineNpm = pkg.engines?.npm;
    expect(engineNpm).toBeDefined();
    expect(engineNpm).toMatch(/^~10\.9\.0/);
  });

  it('engines.npm does NOT allow npm 11 (different dependency resolution)', () => {
    const pkg = readPackageJson();
    const engineNpm = pkg.engines?.npm;
    const semver = require('semver');
    expect(semver.satisfies('11.13.0', engineNpm)).toBe(false);
    expect(semver.satisfies('10.9.8', engineNpm)).toBe(true);
    expect(semver.satisfies('10.9.7', engineNpm)).toBe(true);
  });

  it('Dockerfile npm version is within engines range', () => {
    const dockerfile = readDockerfile();
    const npmMatch = dockerfile.match(/npm\s+(\d+\.\d+\.\d+)/);
    expect(npmMatch).not.toBeNull();
    const dockerNpmVersion = npmMatch![1];

    const pkg = readPackageJson();
    const semver = require('semver');
    expect(semver.satisfies(dockerNpmVersion, pkg.engines.npm)).toBe(true);
  });

  it('.nvmrc node version matches Dockerfile node version', () => {
    const nvmrc = readNvmrc();
    const dockerfile = readDockerfile();
    const nodeMatch = dockerfile.match(/node\s+v(\d+\.\d+\.\d+)/);
    expect(nodeMatch).not.toBeNull();
    const dockerNodeVersion = nodeMatch![1];

    expect(nvmrc).toBe(dockerNodeVersion);
  });
});
