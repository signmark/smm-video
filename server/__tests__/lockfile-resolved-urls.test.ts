/**
 * Сторож против руками правленного package-lock.json.
 *
 * ПОЧЕМУ. 10.08 обновление sharp 0.34 -> 0.35 делалось скриптом, который сам
 * собирал поле `resolved`. Для scoped-пакетов он склеил scope дважды:
 *
 *   .../@img/sharp-linux-x64/-/@img/sharp-linux-x64-0.35.3.tgz   HTTP 404
 *   .../@img/sharp-linux-x64/-/sharp-linux-x64-0.35.3.tgz        HTTP 200
 *
 * Все платформенные бинари sharp помечены "optional": true, а npm при ошибке
 * загрузки optional-зависимости НЕ падает — он молча её пропускает и выходит с
 * кодом 0. Поэтому `npm ci` отчитался «1538 packages, exit 0», `npm run check`
 * и `npm run build` прошли (им sharp не нужен), и только тесты, реально
 * грузящие модуль, упали с «Could not load the sharp module».
 *
 * Вывод, который стоит держать в тестах, а не в памяти: нулевой код возврата
 * `npm ci` не доказывает, что зависимости встали.
 *
 * ЧТО ПРОВЕРЯЕМ (офлайн, без сети). Имя тарбола в `resolved` обязано быть
 * каноническим: <registry>/<полное имя>/-/<имя без scope>-<version>.tgz.
 * Этот формат генерирует сам npm; любое отклонение означает, что поле писал
 * не npm, а человек или скрипт — то есть лок больше не описывает то, что
 * реально скачается.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type LockEntry = { version?: string; resolved?: string };

const lock = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package-lock.json'), 'utf-8'),
) as { packages: Record<string, LockEntry> };

describe('package-lock.json: поле resolved пишет npm, а не человек', () => {
  it('имя тарбола каноническое для всех записей из реестра npm', () => {
    const broken: string[] = [];
    let checked = 0;

    for (const [key, entry] of Object.entries(lock.packages)) {
      const { version, resolved } = entry ?? {};
      // Корень проекта и link-записи ссылок на тарбол не имеют.
      if (!resolved || !version) continue;
      // Ссылки на git, файлы и сторонние реестры живут по своим правилам.
      if (!resolved.startsWith('https://registry.npmjs.org/')) continue;

      const marker = 'node_modules/';
      const name = key.slice(key.lastIndexOf(marker) + marker.length);
      // Для @scope/pkg npm кладёт тарбол под именем pkg-<version>.tgz —
      // без scope. Именно на этом и сломался скрипт.
      const bare = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
      const expected = `https://registry.npmjs.org/${name}/-/${bare}-${version}.tgz`;

      checked += 1;
      if (resolved !== expected) {
        broken.push(`${name}@${version}\n    в локе: ${resolved}\n    ожидалось: ${expected}`);
      }
    }

    // Пустой обход дал бы «зелёный», ничего не проверив.
    expect(checked).toBeGreaterThan(1000);
    expect(
      broken,
      `Ссылки на тарболы не совпадают с тем, что сгенерировал бы npm.\n` +
        `Такие пакеты, если они optional, npm молча пропустит, и npm ci всё равно вернёт 0.\n` +
        `Не правь lock руками — перегенерируй его npm.\n\n${broken.join('\n')}`,
    ).toEqual([]);
  });
});
