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
    //
    // test:dates:msk — те же date-файлы во втором часовом поясе. Прод и CI
    // гоняют в UTC, где проверка, завязанная на смещение, может выродиться и
    // стать зелёной при перепутанном знаке (так и случилось 06.08).
    const res = await runDeploy(work);

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check', 'check:client', 'test:run', 'test:dates:msk']);
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

/**
 * Сверка установленного дерева с локом выкатываемого коммита (AI-98).
 *
 * Прежняя защита сравнивала два ФАЙЛА лока — коммита и репозитория — и молчала
 * в самом частом случае: merge обновил лок в репозитории, `npm ci` никто не
 * выполнил. Файлы совпадают, дерево от предыдущего лока, preflight зелёный и
 * бессмысленный. 11.08.2026 это поймали руками дважды подряд.
 *
 * Поэтому во всех тестах ниже лок репозитория РАВЕН локу коммита — старая
 * проверка тут не сработала бы вовсе.
 */
describe('AI-98: устаревшее дерево node_modules', () => {
  /**
   * Лок в форме, которую пишет npm: карта `packages` с версиями.
   * Значение — либо строка-версия, либо пара [версия, флаги] для optional-записей.
   */
  type Entry = string | [string, Record<string, boolean>];
  const lockJson = (pkgs: Record<string, Entry>) =>
    JSON.stringify({
      name: 'x',
      lockfileVersion: 3,
      packages: {
        '': { name: 'x', version: '1.0.0' },
        ...Object.fromEntries(
          Object.entries(pkgs).map(([n, e]) => [
            `node_modules/${n}`,
            typeof e === 'string' ? { version: e } : { version: e[0], ...e[1] },
          ]),
        ),
      },
    });

  /**
   * Настоящее установленное дерево: каталоги с package.json ПЛЮС манифест,
   * который пишет npm.
   *
   * Каталоги обязательны: версия читается с диска, а не из манифеста. Манифест
   * врёт после `npm install --package-lock-only` — он переписывается под идеальное
   * дерево, ничего не устанавливая (замер 11.08.2026: на диске nanoid 3.3.7,
   * в манифесте и локе 3.3.11).
   */
  const installTree = (work: string, pkgs: Record<string, Entry>) => {
    const modules = path.join(work, 'node_modules');
    mkdirSync(modules, { recursive: true });
    writeFileSync(path.join(modules, '.package-lock.json'), lockJson(pkgs));
    for (const [name, e] of Object.entries(pkgs)) {
      const dir = path.join(modules, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: typeof e === 'string' ? e : e[0] }));
    }
  };

  /**
   * Дерево, у которого манифест разошёлся с диском: ровно результат
   * `npm install --package-lock-only`. Манифест обещает одно, каталоги другое.
   */
  const installTreeDesynced = (work: string, manifest: Record<string, Entry>, disk: Record<string, string>) => {
    const modules = path.join(work, 'node_modules');
    mkdirSync(modules, { recursive: true });
    writeFileSync(path.join(modules, '.package-lock.json'), lockJson(manifest));
    for (const [name, v] of Object.entries(disk)) {
      const dir = path.join(modules, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: v }));
    }
  };

  it('расхождение версий останавливает деплой до проверок', async () => {
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));
    installTree(work, { uuid: '9.0.0' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).not.toBe(0);
    // В сообщении обязана быть команда починки: без неё дежурный не знает, что делать.
    expect(res.stderr).toContain('npm ci');
    expect(res.stderr).toContain('uuid');
    expect(eventLabels()).toContain('preflight_stale_modules');
    // Главное: проверки не гонялись. Зелёный прогон на чужом дереве хуже отказа.
    expect(npmCalls()).toEqual([]);
    expect(existsSync(path.join(root, 'state', 'built'))).toBe(false);
  });

  it('лишний пакет в дереве — тоже признак устаревшей установки', async () => {
    // Ровно то, что осталось в /root/smm после слияния AI-94: три вложенных uuid,
    // которых в новом локе уже нет.
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));
    installTree(work, { uuid: '11.1.1', 'left-pad': '1.3.0' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('left-pad');
    expect(npmCalls()).toEqual([]);
  });

  it('совпадающее дерево не мешает деплою', async () => {
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));
    installTree(work, { uuid: '11.1.1' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check']);
    expect(eventLabels()).not.toContain('preflight_stale_modules');
  });

  it('опциональные пакеты чужих платформ не считаются расхождением', async () => {
    // Различающий признак — ФЛАГ в локе, а не сам факт отсутствия. На живом дереве
    // 11.08.2026 из 1726 записей манифеста 186 не имеют каталога, и все 186
    // помечены optional/devOptional: это @esbuild/darwin-*, @rollup/*-android-*
    // и подобные. Без фильтра по флагу проверка была бы вечно красной.
    const { work } = makeJsRepo(
      lockJson({
        uuid: '11.1.1',
        '@esbuild/darwin-arm64': ['0.28.2', { optional: true, dev: true }],
        '@rollup/rollup-android-arm64': ['4.0.0', { devOptional: true }],
      }),
    );
    installTree(work, { uuid: '11.1.1' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check']);
    expect(eventLabels()).not.toContain('preflight_stale_modules');
  });

  it('SMM_ALLOW_STALE_MODULES пропускает сверку осознанно', async () => {
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));
    installTree(work, { uuid: '9.0.0' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check', SMM_ALLOW_STALE_MODULES: '1' });

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check']);
    // Пропуск остаётся в журнале: постфактум видно, что прогон был на чужом дереве.
    expect(eventLabels()).toContain('preflight_stale_modules');
  });

  it('дерево без манифеста npm не блокирует деплой', async () => {
    // Установка древним npm или распаковка мимо него: .package-lock.json нет,
    // сверять не с чем. Это не повод отказывать в выкатке.
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check']);
  });

  // --- missing non-optional (follow-up к AI-98) ---
  //
  // Класс из AI-59: в лок добавили обычный пакет (тогда это был jsdom), дерево не
  // переустановили. Лишних нет, версии совпадают — прежние два сигнала молчат,
  // а preflight гоняется без пакета, который коду уже нужен.
  //
  // Отсутствие считается по диску: пакета нет, если нет каталога с package.json.
  // Ложных срабатываний это не даёт, потому что отсутствие фильтруется по флагу
  // optional/devOptional. Фильтр обязателен: на живом дереве 11.08 каталогов нет
  // у 186 записей лока из 1726, и все 186 помечены — это пакеты под чужие
  // платформы, npm их не ставит намеренно. Без фильтра проверка была бы вечно
  // красной; с фильтром на здоровом дереве ноль срабатываний.
  it('отсутствующий обычный пакет останавливает деплой', async () => {
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1', jsdom: '30.0.1' }));
    installTree(work, { uuid: '11.1.1' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('jsdom');
    expect(res.stderr).toContain('npm ci');
    expect(eventLabels()).toContain('preflight_stale_modules');
    expect(npmCalls()).toEqual([]);
  });

  // Главный случай, ради которого версия читается с диска, а не из манифеста.
  // `npm install --package-lock-only` переписывает node_modules/.package-lock.json
  // под идеальное дерево, ничего не устанавливая. После такой команды манифест
  // СОВПАДАЕТ с локом выкатываемого коммита, а дерево осталось прежним — проверка
  // по манифесту пропустила бы ровно тот случай, ради которого заведена.
  it('манифест, совпавший с локом при устаревшем диске, не обманывает проверку', async () => {
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));
    installTreeDesynced(work, { uuid: '11.1.1' }, { uuid: '9.0.0' });

    const res = await runDeploy(work, { SMM_PREFLIGHT_STEPS: 'check' });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('uuid');
    expect(eventLabels()).toContain('preflight_stale_modules');
    expect(npmCalls()).toEqual([]);
  });

  it('сломанный разбор не блокирует деплой', async () => {
    const { work } = makeJsRepo(lockJson({ uuid: '11.1.1' }));
    installTree(work, { uuid: '11.1.1' });

    const res = await runDeploy(work, {
      SMM_PREFLIGHT_STEPS: 'check',
      SMM_NODE: path.join(root, 'bin', 'nonexistent-node'),
    });

    expect(res.code).toBe(0);
    expect(npmCalls()).toEqual(['check']);
    expect(eventLabels()).toContain('preflight_tree_check_error');
  });
});
