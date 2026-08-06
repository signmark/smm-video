/**
 * Предвыкаточные проверки кода (AI-38).
 *
 * Зачем вообще: деплой не смотрит на статус CI и обгоняет его — push и выкатка
 * идут подряд, а прогон длится минуты, поэтому красный CI не мешает проду
 * обновиться. Доступа к статусу нет (на проде нет gh и GITHUB_TOKEN), значит
 * единственная работающая защита — прогнать те же шаги локально до переключения
 * контейнера. 06.08.2026 клиентская правка уехала в прод без тайпчека именно
 * потому, что набор команд держался в голове исполнителя.
 *
 * Здесь проверяется поведение скрипта, а не npm: npm подменяется фейком,
 * который пишет журнал вызовов и умеет падать на заданном шаге.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/deploy-smm.sh');

let root: string;

/** Фейковый npm: журналирует `run <step>` и падает, если шаг указан в FAKE_NPM_FAIL. */
const FAKE_NPM = `#!/usr/bin/env bash
set -eu
if [ "\${1:-}" = "run" ]; then
  echo "\${2:-}" >> "\$FAKE_NPM_LOG"
  if [ -n "\${FAKE_NPM_FAIL:-}" ] && [ "\${2:-}" = "\$FAKE_NPM_FAIL" ]; then
    echo "fake npm: шаг \${2:-} упал" >&2
    exit 1
  fi
fi
exit 0
`;

const FAKE_DOCKER = `#!/usr/bin/env bash
set -u
# Прогон идёт с --dry-run: до сборки и переключения дело не доходит, поэтому
# фейку достаточно уметь отдавать конфиг compose — остальное скрипт не спросит.
case "\${1:-}" in
  compose)
    case "\$*" in
      *" config"*) cat "\$FAKE_COMPOSE_CONFIG"; exit 0 ;;
    esac
    exit 0
    ;;
  build) echo built > "\$FAKE_STATE/built"; exit 0 ;;
esac
exit 0
`;

const COMPOSE_OK = `services:
  smm:
    container_name: smm
    image: root-smm:deployed
    restart: always
  directus:
    image: directus/directus:11.2.2
`;

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

/** Репозиторий, который выглядит как JS-проект: с package.json и локом. */
function makeJsRepo(lock = '{"v":1}') {
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'smm');
  const authoring = path.join(root, 'authoring');

  execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', origin, authoring]);
  git(authoring, ['config', 'user.email', 't@t']);
  git(authoring, ['config', 'user.name', 'T']);
  writeFileSync(path.join(authoring, 'Dockerfile'), 'FROM scratch\n');
  writeFileSync(path.join(authoring, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  writeFileSync(path.join(authoring, 'package-lock.json'), lock);
  git(authoring, ['add', '-A']);
  git(authoring, ['commit', '-m', 'v1']);
  git(authoring, ['push', 'origin', 'main']);

  execFileSync('git', ['clone', origin, work]);
  // node_modules берётся из основного дерева — как на проде.
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  return { work, authoring };
}

function runDeploy(work: string, env: Record<string, string> = {}) {
  const merged: Record<string, string> = {
    ...process.env,
    SMM_REPO_DIR: work,
    SMM_COMPOSE_FILE: path.join(root, 'docker-compose.yml'),
    SMM_LOCK_FILE: path.join(root, 'deploy.lock'),
    SMM_WORKTREE_BASE: path.join(root, 'worktrees'),
    SMM_DOCKER: path.join(root, 'bin', 'docker'),
    SMM_CURL: path.join(root, 'bin', 'curl'),
    SMM_NPM: path.join(root, 'bin', 'npm'),
    SMM_EVENT_LOG: path.join(root, 'events.log'),
    SMM_DOCKER_ROOT: root,
    SMM_HEALTH_RETRIES: '1',
    SMM_HEALTH_DELAY: '0',
    SMM_LOCK_WAIT: '60',
    FAKE_STATE: path.join(root, 'state'),
    FAKE_COMPOSE_CONFIG: path.join(root, 'compose-config.yml'),
    FAKE_NPM_LOG: path.join(root, 'npm.log'),
    ...env,
  };

  return new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile('bash', [SCRIPT, '--dry-run'], { env: merged, timeout: 60_000 }, (err, _o, stderr) => {
      resolve({ code: err ? ((err as never as { code: number }).code ?? 1) : 0, stderr: String(stderr) });
    });
  });
}

const npmCalls = (): string[] => {
  const f = path.join(root, 'npm.log');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};

const eventLabels = (): string[] => {
  const f = path.join(root, 'events.log');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ai38-'));
  mkdirSync(path.join(root, 'bin'));
  mkdirSync(path.join(root, 'state'));
  writeFileSync(path.join(root, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 });
  writeFileSync(path.join(root, 'bin', 'curl'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(root, 'bin', 'npm'), FAKE_NPM, { mode: 0o755 });
  writeFileSync(path.join(root, 'compose-config.yml'), COMPOSE_OK);
  writeFileSync(path.join(root, 'docker-compose.yml'), COMPOSE_OK);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('AI-38: предвыкаточные проверки', () => {
  it('гоняет шаги CI до сборки', async () => {
    const { work } = makeJsRepo();

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check check:client test:run build' });

    expect(res.code).toBe(0);
    // Именно test:run: `npm run test` — vitest в watch-режиме, он подвесил бы
    // деплой навсегда вместе с удерживаемым flock.
    expect(npmCalls()).toEqual(['check', 'check:client', 'test:run', 'build']);
  });

  it('по умолчанию не пересобирает то, что соберёт docker', async () => {
    const { work } = makeJsRepo();

    // Набор по умолчанию: без build. Следом идёт docker build, а он выполняет
    // `npm run build` внутри образа и точно так же останавливает деплой при
    // ошибке — до переключения контейнера.
    const res = await runDeploy(work);

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check', 'check:client', 'test:run']);
  });

  it('падение любого шага останавливает деплой до сборки', async () => {
    const { work } = makeJsRepo();

    const res = await runDeploy(work, {
      SMM_PREFLIGHT_STEPS: 'check check:client test:run',
      FAKE_NPM_FAIL: 'check:client',
    });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('check:client');
    // До шагов после упавшего дело не дошло.
    expect(npmCalls()).toEqual(['check', 'check:client']);
    expect(eventLabels()).toContain('preflight_failed');
    // Сборка не начиналась: прод не тронут.
    expect(existsSync(path.join(root, 'state', 'built'))).toBe(false);
  });

  it('SMM_SKIP_PREFLIGHT пропускает проверки осознанно', async () => {
    const { work } = makeJsRepo();

    const res = await runDeploy(work, { SMM_SKIP_PREFLIGHT: '1' });

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual([]);
    expect(eventLabels()).toContain('preflight_skipped');
  });

  it('репозиторий без package.json не считается сломанным', async () => {
    // На этом же скрипте гоняются тесты сериализации с не-JS репозиторием.
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'smm');
    const authoring = path.join(root, 'authoring');
    execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', origin, authoring]);
    git(authoring, ['config', 'user.email', 't@t']);
    git(authoring, ['config', 'user.name', 'T']);
    writeFileSync(path.join(authoring, 'Dockerfile'), 'FROM scratch\n');
    git(authoring, ['add', '-A']);
    git(authoring, ['commit', '-m', 'v1']);
    git(authoring, ['push', 'origin', 'main']);
    execFileSync('git', ['clone', origin, work]);

    const res = await runDeploy(work);

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual([]);
  });

  it('расхождение lock-файла с установленным деревом попадает в журнал', async () => {
    const { work } = makeJsRepo('{"v":1}');
    // Установленные модули соответствуют другому локу, чем выкатываемый коммит.
    writeFileSync(path.join(work, 'package-lock.json'), '{"v":2}');

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).toBe(0);
    expect(eventLabels()).toContain('preflight_lock_mismatch');
  });

  it('без node_modules деплой останавливается, а не проверяет вхолостую', async () => {
    const { work } = makeJsRepo();
    rmSync(path.join(work, 'node_modules'), { recursive: true, force: true });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('node_modules');
    expect(npmCalls()).toEqual([]);
  });
});
