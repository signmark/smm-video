/**
 * Сериализация сборки и выкатки (AI-50).
 *
 * Проверяется поведение `scripts/deploy-smm.sh`, а не docker: два реальных
 * прод-билда ради проверки гонки запускать нельзя — сама проверка и стала бы
 * тем инцидентом, от которого защищаемся. Поэтому docker и curl подменяются
 * фейками, git — настоящий (он дёшев и детерминирован), а гонка
 * воспроизводится на временном репозитории.
 *
 * Что именно стережётся:
 *  - critical section двух процессов не пересекаются (иначе параллельные
 *    сборки вернутся);
 *  - устаревшая сборка не переключает контейнер (иначе вернётся молчаливый
 *    откат чужой работы — тот самый инцидент 31.07.2026);
 *  - контекст сборки не содержит чужих незакоммиченных файлов;
 *  - неудачные build/up/health не меняют текущий deployed;
 *  - несовпадение provenance ловится;
 *  - compose, умеющий собирать образ, отвергается до любых действий.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/deploy-smm.sh');

let root: string;

/** Фейковый docker: пишет журнал и держит состояние образов/контейнера файлами. */
const FAKE_DOCKER = `#!/usr/bin/env bash
set -u
STATE="\$FAKE_STATE"
mkdir -p "\$STATE/images"
echo "\$*" >> "\$STATE/docker.calls"

img_file() { echo "\$STATE/images/\$(echo "\$1" | tr '/:' '__')"; }

case "\$1" in
  compose)
    # docker compose -f FILE (config|up ...)
    ALL="\$*"
    case "\$ALL" in
      *" config"*)
        cat "\$FAKE_COMPOSE_CONFIG"
        exit 0
        ;;
    esac
    # up
    if [ -n "\${FAKE_UP_FAIL:-}" ]; then echo "up failed" >&2; exit 1; fi
    dep="\$(img_file "\$FAKE_DEPLOYED_TAG")"
    if [ -f "\$dep" ]; then cp "\$dep" "\$STATE/container"; fi
    echo "up done"
    exit 0
    ;;
  build)
    ctx=""; tag=""; sha=""
    while [ \$# -gt 0 ]; do
      case "\$1" in
        --build-arg) case "\$2" in APP_COMMIT_SHA=*) sha="\${2#APP_COMMIT_SHA=}";; esac; shift 2;;
        --label) shift 2;;
        -t) tag="\$2"; shift 2;;
        -f) shift 2;;
        build) shift;;
        *) ctx="\$1"; shift;;
      esac
    done
    # Слепок контекста: тест проверяет, что чужие незакоммиченные файлы сюда не попали.
    ( cd "\$ctx" && ls -A ) > "\$STATE/last_build_context.txt" 2>/dev/null || true
    echo "\$ctx" > "\$STATE/last_build_context_dir.txt"
    [ -n "\${FAKE_BUILD_SLEEP:-}" ] && sleep "\$FAKE_BUILD_SLEEP"
    if [ -n "\${FAKE_BUILD_FAIL:-}" ]; then echo "build failed" >&2; exit 1; fi
    # Образ = файл с revision. FAKE_BUILD_REVISION позволяет подделать метку.
    echo "\${FAKE_BUILD_REVISION:-\$sha}" > "\$(img_file "\$tag")"
    exit 0
    ;;
  tag)
    # Настоящий docker умеет тегировать и по image id, и по тегу — откат
    # пользуется именно id, поэтому фейк обязан уметь так же.
    dst="\$(img_file "\$3")"
    case "\$2" in
      sha256:*) printf '%s\\n' "\${2#sha256:}" > "\$dst"; exit 0;;
    esac
    src="\$(img_file "\$2")"
    [ -f "\$src" ] || { echo "no such image \$2" >&2; exit 1; }
    cp "\$src" "\$dst"; exit 0
    ;;
  images)
    # images <repo> [--no-trunc] --format '{{.Tag}} {{.ID}}' — от новых к старым.
    # Настоящий docker БЕЗ --no-trunc отдаёт короткий id (12 hex), а с ним —
    # полный sha256:<64>. Фейк обязан вести себя так же: расхождение здесь уже
    # один раз спрятало мёртвый код (защита deployed в ротации).
    notrunc=""
    case "\$*" in *--no-trunc*) notrunc=1;; esac
    ls -t "\$STATE/images" 2>/dev/null | while read -r f; do
      tag="\${f#*__}"
      [ "\$tag" = "\$f" ] && tag="\${f#*_}"
      content="\$(cat "\$STATE/images/\$f")"
      if [ -n "\$notrunc" ]; then
        printf '%s sha256:%s\\n' "\$tag" "\$content"
      else
        printf '%s %s\\n' "\$tag" "\$(printf '%s' "\$content" | cut -c1-12)"
      fi
    done
    exit 0
    ;;
  image)
    # image rm TAG | image inspect [--format F] TAG
    if [ "\${2:-}" = "rm" ]; then
      f="\$(img_file "\$3")"
      [ -f "\$f" ] || exit 1
      rm -f "\$f"; exit 0
    fi
    shift
    fmt=""; tgt=""
    while [ \$# -gt 0 ]; do
      case "\$1" in
        inspect) shift;;
        --format) fmt="\$2"; shift 2;;
        *) tgt="\$1"; shift;;
      esac
    done
    f="\$(img_file "\$tgt")"
    [ -f "\$f" ] || exit 1
    case "\$fmt" in
      *".Id"*) echo "sha256:\$(cat "\$f")";;
      *revision*) cat "\$f";;
      "") echo "{}";;
      *) cat "\$f";;
    esac
    exit 0
    ;;
  inspect)
    # inspect --format F smm  (контейнер)
    [ -f "\$STATE/container" ] || exit 1
    cat "\$STATE/container"; exit 0
    ;;
esac
exit 0
`;

/** Фейковый curl: /health отдаёт revision запущенного «контейнера». */
const FAKE_CURL = `#!/usr/bin/env bash
set -u
STATE="\$FAKE_STATE"
if printf '%s ' "\$@" | grep -q -- '-w'; then
  echo "\${FAKE_PUBLIC_CODE:-200}"
  exit 0
fi
rev="unknown"
[ -f "\$STATE/container" ] && rev="\$(cat "\$STATE/container")"
echo "{\\"status\\":\\"healthy\\",\\"revision\\":\\"\$rev\\"}"
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

const COMPOSE_WITH_BUILD = `services:
  smm:
    build:
      context: ./smm
    container_name: smm
    image: root-smm:deployed
  directus:
    image: directus/directus:11.2.2
`;

const COMPOSE_WRONG_IMAGE = `services:
  smm:
    container_name: smm
    image: root-smm:latest
  directus:
    image: directus/directus:11.2.2
`;

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

/** origin + рабочая копия с одним коммитом. Возвращает SHA. */
function makeRepos() {
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'smm');
  const authoring = path.join(root, 'authoring');

  execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', origin, authoring]);
  git(authoring, ['config', 'user.email', 't@t']);
  git(authoring, ['config', 'user.name', 'T']);
  writeFileSync(path.join(authoring, 'Dockerfile'), 'FROM scratch\n');
  writeFileSync(path.join(authoring, 'app.txt'), 'v1\n');
  git(authoring, ['add', '-A']);
  git(authoring, ['commit', '-m', 'v1']);
  git(authoring, ['push', 'origin', 'main']);

  execFileSync('git', ['clone', origin, work]);
  const sha1 = git(work, ['rev-parse', 'origin/main']).trim();
  return { origin, work, authoring, sha1 };
}

let commitSeq = 1;
function pushSecondCommit(authoring: string): string {
  // Содержимое обязано отличаться на каждом вызове: одинаковый файл даёт пустой
  // коммит, git падает, и тест краснеет по причине, не связанной с делом.
  commitSeq += 1;
  const label = `v${commitSeq}`;
  writeFileSync(path.join(authoring, 'app.txt'), `${label}\n`);
  git(authoring, ['add', '-A']);
  git(authoring, ['commit', '-m', label]);
  git(authoring, ['push', 'origin', 'main']);
  return git(authoring, ['rev-parse', 'HEAD']).trim();
}

type RunOpts = { env?: Record<string, string>; args?: string[] };

function runDeploy(work: string, opts: RunOpts = {}): Promise<{ code: number; stderr: string }> {
  const env: Record<string, string> = {
    ...process.env,
    SMM_REPO_DIR: work,
    SMM_COMPOSE_FILE: path.join(root, 'docker-compose.yml'),
    SMM_LOCK_FILE: path.join(root, 'deploy.lock'),
    SMM_WORKTREE_BASE: path.join(root, 'worktrees'),
    SMM_DOCKER: path.join(root, 'bin', 'docker'),
    SMM_CURL: path.join(root, 'bin', 'curl'),
    SMM_EVENT_LOG: path.join(root, 'events.log'),
    // Каталог для измерения свободного места — свой. Тест обязан быть
    // герметичным: наличие /var/lib/docker на машине не должно влиять ни на
    // результат, ни на то, сработает ли порог. Отдельные тесты
    // переопределяют это значение осознанно.
    SMM_DOCKER_ROOT: root,
    SMM_HEALTH_RETRIES: '3',
    SMM_HEALTH_DELAY: '0',
    SMM_LOCK_WAIT: '60',
    FAKE_STATE: path.join(root, 'state'),
    FAKE_COMPOSE_CONFIG: path.join(root, 'compose-config.yml'),
    FAKE_DEPLOYED_TAG: 'root-smm:deployed',
    ...(opts.env ?? {}),
  };

  return new Promise((resolve) => {
    execFile('bash', [SCRIPT, ...(opts.args ?? [])], { env, timeout: 60_000 }, (err, _out, stderr) => {
      resolve({ code: err ? ((err as never as { code: number }).code ?? 1) : 0, stderr: String(stderr) });
    });
  });
}

type Ev = { label: string; pid: string; ns: bigint };

function events(): Ev[] {
  const f = path.join(root, 'events.log');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [label, pid, ns] = l.split('\t');
      return { label, pid, ns: BigInt(ns) };
    });
}

const deployedRevision = (): string | null => {
  const f = path.join(root, 'state', 'images', 'root-smm_deployed');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ai50-'));
  mkdirSync(path.join(root, 'bin'));
  mkdirSync(path.join(root, 'state'));
  writeFileSync(path.join(root, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 });
  writeFileSync(path.join(root, 'bin', 'curl'), FAKE_CURL, { mode: 0o755 });
  writeFileSync(path.join(root, 'compose-config.yml'), COMPOSE_OK);
  writeFileSync(path.join(root, 'docker-compose.yml'), COMPOSE_OK);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('preflight: compose не должен уметь собирать образ', () => {
  it('секция build: у сервиса smm отвергается до любых действий', async () => {
    writeFileSync(path.join(root, 'compose-config.yml'), COMPOSE_WITH_BUILD);
    const { work } = makeRepos();

    const res = await runDeploy(work);

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('build:');
    // Именно «до любых действий»: сборка не начиналась.
    expect(events().some((e) => e.label === 'build_start')).toBe(false);
  });

  it('чужой тег образа отвергается', async () => {
    writeFileSync(path.join(root, 'compose-config.yml'), COMPOSE_WRONG_IMAGE);
    const { work } = makeRepos();

    const res = await runDeploy(work);

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('root-smm:deployed');
    expect(events().some((e) => e.label === 'build_start')).toBe(false);
  });
});

describe('контекст сборки', () => {
  it('чужие незакоммиченные файлы в контекст не попадают', async () => {
    const { work } = makeRepos();
    // Ровно тот случай, что был на проде: в общем каталоге лежит чужой WIP.
    writeFileSync(path.join(work, 'SENTINEL-чужой-wip.txt'), 'not mine\n');
    mkdirSync(path.join(work, 'hermes_dashboard'));
    writeFileSync(path.join(work, 'hermes_dashboard', 'x.txt'), 'x\n');

    const res = await runDeploy(work);
    expect(res.code).toBe(0);

    const ctx = readFileSync(path.join(root, 'state', 'last_build_context.txt'), 'utf8');
    expect(ctx).not.toContain('SENTINEL');
    expect(ctx).not.toContain('hermes_dashboard');
    expect(ctx).toContain('Dockerfile');

    // И контекст — не общий каталог.
    const ctxDir = readFileSync(path.join(root, 'state', 'last_build_context_dir.txt'), 'utf8').trim();
    expect(ctxDir).not.toBe(work);
  });
});

describe('устаревшая сборка не переключает контейнер', () => {
  it('main уехал во время сборки — A выходит retryable, переключает только B', async () => {
    const { work, authoring, sha1 } = makeRepos();

    // A строит долго; пока строит, появляется SHA2.
    const a = runDeploy(work, { env: { FAKE_BUILD_SLEEP: '2' } });
    await new Promise((r) => setTimeout(r, 700));
    const sha2 = pushSecondCommit(authoring);
    expect(sha2).not.toBe(sha1);

    const resA = await a;

    // 75 — «повтори», а не «сломалось».
    expect(resA.code).toBe(75);
    expect(deployedRevision()).toBeNull();

    // B приходит следом и выкатывает уже актуальный SHA2.
    const resB = await runDeploy(work);
    expect(resB.code).toBe(0);
    expect(deployedRevision()).toBe(sha2);
  }, 60_000);

  it('critical sections двух процессов не пересекаются', async () => {
    const { work } = makeRepos();

    const [r1, r2] = await Promise.all([
      runDeploy(work, { env: { FAKE_BUILD_SLEEP: '1' } }),
      runDeploy(work, { env: { FAKE_BUILD_SLEEP: '1' } }),
    ]);

    // Один выкатился, второй либо тоже (тот же SHA), либо ушёл retryable —
    // но оба не должны были строить одновременно.
    expect([0, 75]).toContain(r1.code);
    expect([0, 75]).toContain(r2.code);

    const evs = events();
    const pids = [...new Set(evs.map((e) => e.pid))];
    expect(pids.length).toBe(2);

    const span = (pid: string) => {
      const acq = evs.find((e) => e.pid === pid && e.label === 'lock_acquired');
      const rel = evs.find((e) => e.pid === pid && e.label === 'lock_released');
      expect(acq, `нет lock_acquired у ${pid}`).toBeDefined();
      expect(rel, `нет lock_released у ${pid}`).toBeDefined();
      return [acq!.ns, rel!.ns] as const;
    };

    const [a1, a2] = [span(pids[0]), span(pids[1])];
    const overlap = a1[0] < a2[1] && a2[0] < a1[1];
    expect(overlap, 'critical sections пересеклись — flock не держит').toBe(false);
  }, 60_000);
});

describe('неудача не меняет выкаченное', () => {
  it('сбой сборки: deployed остаётся прежним, лок отпущен', async () => {
    const { work } = makeRepos();

    const ok = await runDeploy(work);
    expect(ok.code).toBe(0);
    const before = deployedRevision();
    expect(before).not.toBeNull();

    const bad = await runDeploy(work, { env: { FAKE_BUILD_FAIL: '1' } });
    expect(bad.code).not.toBe(0);
    expect(deployedRevision()).toBe(before);

    // Лок отпущен: следующий запуск не висит.
    const after = await runDeploy(work);
    expect(after.code).toBe(0);
  }, 60_000);

  it('сбой up: alias возвращается на предыдущий образ', async () => {
    const { work, authoring } = makeRepos();

    expect((await runDeploy(work)).code).toBe(0);
    const before = deployedRevision();

    pushSecondCommit(authoring);
    const bad = await runDeploy(work, { env: { FAKE_UP_FAIL: '1' } });

    expect(bad.code).not.toBe(0);
    expect(deployedRevision()).toBe(before);
  }, 60_000);

  it('несовпадение provenance ловится и откатывается', async () => {
    const { work, authoring } = makeRepos();

    expect((await runDeploy(work)).code).toBe(0);
    const before = deployedRevision();

    pushSecondCommit(authoring);
    // Образ собран, но метка revision — чужая.
    const bad = await runDeploy(work, { env: { FAKE_BUILD_REVISION: 'deadbeef' } });

    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toMatch(/revision/i);
    expect(deployedRevision()).toBe(before);
  }, 60_000);
});

describe('место на диске и ротация образов (AI-51)', () => {
  it('сборка не начинается, если свободного места меньше порога', async () => {
    const { work } = makeRepos();

    const res = await runDeploy(work, { env: { SMM_MIN_FREE_MB: '999999999' } });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/свободно/i);
    // Именно «не начинается»: упасть на середине сборки из-за места хуже.
    expect(events().some((e) => e.label === 'build_start')).toBe(false);
    expect(deployedRevision()).toBeNull();
  }, 60_000);

  it('старые сборки убираются, но остаются последние N', async () => {
    const { work, authoring } = makeRepos();
    const shas: string[] = [];

    // Пять выкаток подряд при лимите в 2.
    expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '2' } })).code).toBe(0);
    for (let i = 0; i < 4; i++) {
      shas.push(pushSecondCommit(authoring));
      expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '2' } })).code).toBe(0);
    }

    const imagesDir = path.join(root, 'state', 'images');
    const shaTags = readdirSync(imagesDir).filter((f) => /^root-smm_[0-9a-f]{40}$/.test(f));

    // Держим ровно N последних. Текущий выкаченный входит в них.
    expect(shaTags.length).toBe(2);
    const newest = shas[shas.length - 1];
    expect(shaTags.some((f) => f.endsWith(newest))).toBe(true);
    // Самая старая сборка удалена.
    expect(shaTags.some((f) => f.endsWith(shas[0]))).toBe(false);
  }, 120_000);

  it('человеческие метки и алиас deployed ротацией не трогаются', async () => {
    const { work, authoring } = makeRepos();
    expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1' } })).code).toBe(0);

    // Точка отката, поставленная руками: не полный SHA — значит не автотег.
    const imagesDir = path.join(root, 'state', 'images');
    writeFileSync(path.join(imagesDir, 'root-smm_pre-release-marker'), 'manual\n');

    for (let i = 0; i < 3; i++) {
      pushSecondCommit(authoring);
      expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1' } })).code).toBe(0);
    }

    const left = readdirSync(imagesDir);
    expect(left).toContain('root-smm_pre-release-marker');
    expect(left).toContain('root-smm_deployed');
  }, 120_000);

  it('неудачный деплой ничего не удаляет', async () => {
    const { work, authoring } = makeRepos();
    expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1' } })).code).toBe(0);
    pushSecondCommit(authoring);
    expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1' } })).code).toBe(0);

    const before = readdirSync(path.join(root, 'state', 'images')).sort();

    pushSecondCommit(authoring);
    const bad = await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1', FAKE_UP_FAIL: '1' } });
    expect(bad.code).not.toBe(0);

    // Старые образы — это пути отката. Ронять их на неудаче нельзя.
    const after = readdirSync(path.join(root, 'state', 'images')).sort();
    expect(after).toEqual(expect.arrayContaining(before));
  }, 120_000);
});

describe('находки приёмки AI-51', () => {
  // Finding 1: ветка «не смог измерить место» была недостижима — под pipefail
  // падение df убивало скрипт раньше. Из-за этого тесты краснели на любой
  // машине без /var/lib/docker, то есть обязательный прогон перед пушем был
  // выполним только на прод-хосте.
  it('недоступный docker root не ломает деплой, а лишь отключает проверку места', async () => {
    const { work, sha1 } = makeRepos();

    const res = await runDeploy(work, {
      env: { SMM_DOCKER_ROOT: '/nonexistent-' + process.pid },
    });

    expect(res.code).toBe(0);
    expect(deployedRevision()).toBe(sha1);
    expect(events().some((e) => e.label === 'free_space_unknown')).toBe(true);
  }, 60_000);

  // Finding 2: images отдаёт короткий id, inspect — sha256:<64>. Сравнение
  // никогда не совпадало, и защита выкаченного образа была мёртвым кодом.
  // keep=0 просит удалить всё — выжить обязан ровно тот образ, что сейчас
  // запущен.
  it('выкаченный образ не удаляется даже при нулевом лимите хранения', async () => {
    const { work, sha1 } = makeRepos();

    const res = await runDeploy(work, { env: { SMM_KEEP_IMAGES: '0' } });

    expect(res.code).toBe(0);
    const images = readdirSync(path.join(root, 'state', 'images'));
    expect(images).toContain(`root-smm_${sha1}`);
    expect(images).toContain('root-smm_deployed');
  }, 60_000);

  it('алиас deployed не считается автотегом и не удаляется', async () => {
    const { work, authoring } = makeRepos();
    expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1' } })).code).toBe(0);

    for (let i = 0; i < 2; i++) {
      pushSecondCommit(authoring);
      expect((await runDeploy(work, { env: { SMM_KEEP_IMAGES: '1' } })).code).toBe(0);
    }

    // Настоящий docker показывает deployed в выдаче images; фейк раньше его
    // прятал, поэтому фильтр не-hex тегов для него не был покрыт.
    expect(readdirSync(path.join(root, 'state', 'images'))).toContain('root-smm_deployed');
  }, 120_000);
});

describe('happy path', () => {
  it('выкатывает актуальный origin/main и проверяет три источника SHA', async () => {
    const { work, sha1 } = makeRepos();

    const res = await runDeploy(work);

    expect(res.code).toBe(0);
    expect(deployedRevision()).toBe(sha1);
    expect(readFileSync(path.join(root, 'state', 'container'), 'utf8').trim()).toBe(sha1);

    const labels = events().map((e) => e.label);
    expect(labels).toContain('preflight_ok');
    expect(labels).toContain('verify_ok');
    expect(labels).toContain('public_ok');
  }, 60_000);

  it('--dry-run не собирает и не переключает', async () => {
    const { work } = makeRepos();

    const res = await runDeploy(work, { args: ['--dry-run'] });

    expect(res.code).toBe(0);
    expect(deployedRevision()).toBeNull();
    expect(events().some((e) => e.label === 'build_start')).toBe(false);
  }, 60_000);
});
