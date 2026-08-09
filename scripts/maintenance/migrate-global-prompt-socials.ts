/**
 * SM-18: разовая миграция legacy-промтов — сводит к переменной `[socialNetworks]`
 * ТОЛЬКО те имена сетей, что стоят в аудиторной фразе старого авто-генератора
 * («...пользователи Facebook», «...пользователи Facebook, Instagram и VK»).
 *
 * ЗАЧЕМ. Промты, сгенерированные старым «Конфигуратором ассистента» до фикса
 * SM-18, уже сохранены в базе и содержат «...пользователи Facebook» и т.п.
 * Починка генератора старые тексты не трогает. Этот скрипт — безопасное,
 * явно ограниченное правило (rev @Codex_HM, см. `migrateLegacyGlobalPrompt`):
 *
 *   - НЕ трогает произвольный текст: сравнения «Сравни Facebook с Telegram»,
 *     инструкции «пиши для Facebook», отрицания «не используй Facebook» и
 *     любые ручные промты кандидатами НЕ становятся и не меняются.
 *   - НЕ перегенерирует текст и НЕ затирает ручные правки.
 *
 * ДВУХФАЗНЫЙ reviewable ПОТОК (rev @Codex_HM):
 *   1) dry-run (по умолчанию) ничего не пишет, а формирует артефакт-план с
 *      before/after по каждой кампании (campaign id + старый → новый промт)
 *      и сохраняет его через `--out=<path>` для ревью владельца.
 *   2) --apply читает ИМЕННО сохранённый план из `--plan=<path>` (reviewed
 *      before/after) и пишет ТОЛЬКО явно одобренные ID из `--ids=<csv>`.
 *      Для каждого id перечитывает БД и применяет rewrite ТОЛЬКО если текущее
 *      значение БАЙТ В БАЙТ совпадает с пробросмотренным `before` из плана.
 *      Любое изменение между dry-run и apply → ПРОПУСК (0 PATCH). Не
 *      пересчитывает одобренное изменение заново (TOCTOU-safe).
 *      Перед --apply — бэкап user_campaigns.
 *
 * Использование:
 *   # 1) посмотреть кандидатов (ничего не меняет; сохранить план в файл):
 *   DIRECTUS_URL=... DIRECTUS_TOKEN=... npx tsx scripts/maintenance/migrate-global-prompt-socials.ts --out=./migrate-plan.json
 *
 *   # 2) применить ТОЛЬКО для одобренных id, опираясь на просмотренный план:
 *   DIRECTUS_URL=... DIRECTUS_TOKEN=... npx tsx scripts/maintenance/migrate-global-prompt-socials.ts \
 *       --apply --plan=./migrate-plan.json --ids=camp-1,camp-2
 */

import axios from 'axios';
import { migrateLegacyGlobalPrompt } from '../../server/services/social-prompt';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN =
  process.env.DIRECTUS_TOKEN ||
  process.env.DIRECTUS_SERVICE_TOKEN ||
  process.env.DIRECTUS_ADMIN_TOKEN;

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 100;

function flagValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(flag + '='));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const OUT_FILE = flagValue('--out');
const PLAN_FILE = flagValue('--plan');
const IDS_PARAM = flagValue('--ids');
const ALLOWED_IDS: Set<string> | null = APPLY
  ? new Set((IDS_PARAM || '').split(',').map((s) => s.trim()).filter(Boolean))
  : null;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.error('[migrate-global-prompt-socials] Требуются DIRECTUS_URL и DIRECTUS_TOKEN');
  process.exit(1);
}
if (APPLY && (!ALLOWED_IDS || ALLOWED_IDS.size === 0)) {
  console.error('[migrate-global-prompt-socials] --apply требует явный allowlist: --ids=camp-1,camp-2');
  process.exit(1);
}
if (APPLY && !PLAN_FILE) {
  console.error('[migrate-global-prompt-socials] --apply требует просмотренный план: --plan=./migrate-plan.json (артефакт из dry-run --out)');
  process.exit(1);
}
if (!APPLY && PLAN_FILE) {
  console.error('[migrate-global-prompt-socials] --plan имеет смысл только вместе с --apply');
  process.exit(1);
}

/** Загружает просмотренный план (артефакт dry-run), если передан --plan. */
let reviewedPlan: { candidates: Array<{ id: string; before: string; after: string; fieldKey: string }> } | null = null;
if (APPLY && PLAN_FILE) {
  const fs = require('node:fs') as typeof import('node:fs');
  if (!fs.existsSync(PLAN_FILE)) {
    console.error(`[migrate-global-prompt-socials] план не найден: ${PLAN_FILE}`);
    process.exit(1);
  }
  try {
    reviewedPlan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
  } catch (e: any) {
    console.error(`[migrate-global-prompt-socials] не удалось прочитать план: ${e?.message || e}`);
    process.exit(1);
  }
}

function parseAutonomousSettings(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, any>) : null;
}

/**
 * TOCTOU-safe решение «применять ли rewrite» (exported для теста).
 * Возвращает true ТОЛЬКО если текущее значение — непустая строка И байт-в-байт
 * совпадает с просмотренным `before` из dry-run-плана. Отсутствие/нестроковое/
 * изменение поля между dry-run и apply → false (не затираем; «любое изменение → 0 PATCH»).
 */
export function shouldApplyLegacyMigration(
  currentPrompt: unknown,
  reviewedBefore: string,
): boolean {
  return typeof currentPrompt === 'string' && currentPrompt === reviewedBefore;
}

/**
 * Применяет один одобренный кандидат из просмотренного плана (exported для теста).
 * Перечитывает свежее поле; если оно НЕ строка или не совпадает байт-в-байт с
 * `reviewed.before` — возвращает 'skip'; иначе патчит `reviewed.after` и 'applied'.
 * Не патчит ничего, если поле изменилось/удалено после dry-run (0 PATCH).
 */
export async function applyReviewedCandidate(
  reviewed: { id: string; before: string; after: string; fieldKey: string },
): Promise<'applied' | 'skip'> {
  const rowRes = await axios.get(`${DIRECTUS_URL}/items/user_campaigns/${reviewed.id}`, {
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
    params: { fields: ['id', 'autonomous_settings', 'social_media_settings'] },
  });
  const row = rowRes.data?.data;
  const cur = parseAutonomousSettings(row?.autonomous_settings) || {};
  const curPrompt = cur[reviewed.fieldKey];
  if (!shouldApplyLegacyMigration(curPrompt, reviewed.before)) {
    console.log(`[migrate-global-prompt-socials] ПРОПУСК ${reviewed.id}: значение изменилось/не строка после dry-run (не совпадает с reviewed.before)`);
    return 'skip';
  }
  cur[reviewed.fieldKey] = reviewed.after;
  await axios.patch(
    `${DIRECTUS_URL}/items/user_campaigns/${reviewed.id}`,
    { autonomous_settings: JSON.stringify(cur) },
    { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } },
  );
  console.log(`[migrate-global-prompt-socials] APPLY обновил кампанию ${reviewed.id}`);
  return 'applied';
}

async function main() {
  let offset = 0;
  let scanned = 0;
  const candidates: Array<{ id: string; before: string; after: string; fieldKey: string }> = [];
  const written: string[] = [];

  while (true) {
    const res = await axios.get(`${DIRECTUS_URL}/items/user_campaigns`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
      params: {
        fields: ['id', 'autonomous_settings', 'social_media_settings'],
        offset,
        limit: PAGE_SIZE,
      },
    });
    const rows: any[] = (res.data?.data || []).filter((r: any) => r != null);
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const row of rows) {
      const settings = parseAutonomousSettings(row.autonomous_settings);
      if (!settings) continue;
      let fieldKey = 'globalPrompt';
      let prompt = '';
      if (typeof settings.globalPrompt === 'string') {
        prompt = settings.globalPrompt;
      } else if (typeof (settings as any)?.global_prompt === 'string') {
        fieldKey = 'global_prompt';
        prompt = String((settings as any).global_prompt);
      }
      if (!prompt) continue;

      const after = migrateLegacyGlobalPrompt(prompt);
      if (after !== prompt) {
        candidates.push({ id: row.id, before: prompt, after, fieldKey });
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (candidates.length === 0) {
    console.log(`[migrate-global-prompt-socials] сканировано кампаний: ${scanned}; кандидатов: 0. Ничего не менять.`);
    return;
  }

  if (APPLY) {
    // В apply-режиме НЕ пересчитываем одобренное изменение: опираемся строго
    // на просмотренный план (before/after из dry-run). Так, если промт изменили
    // после dry-run, проверка свежего значения против просмотренного `before`
    // даст расхождение → ПРОПУСК (TOCTOU-safe).
    const planById = new Map(
      (reviewedPlan?.candidates || []).map((c) => [c.id, c]),
    );
    for (const id of Array.from(ALLOWED_IDS!)) {
      const reviewed = planById.get(id);
      if (!reviewed) {
        console.log(`[migrate-global-prompt-socials] ПРОПУСК ${id}: нет в просмотренном плане`);
        continue;
      }
      const outcome = await applyReviewedCandidate(reviewed);
      if (outcome === 'applied') written.push(id);
    }
    console.log(
      `[migrate-global-prompt-socials] просмотренный план: ${reviewedPlan?.candidates.length || 0} кандидатов; записано: ${written.length} (${written.length === 0 ? 'нет пересечения или все пропущены' : written.join(',')})`,
    );
    return;
  }

  // dry-run
  const plan = { scanned, candidates };
  if (OUT_FILE) {
    const fs = await import('node:fs');
    fs.writeFileSync(OUT_FILE, JSON.stringify(plan, null, 2), 'utf-8');
  }
  console.log(`[migrate-global-prompt-socials] dry-run: сканировано ${scanned}, кандидатов к миграции ${candidates.length}.`);
  for (const c of candidates) {
    console.log(`  campaign ${c.id}:`);
    console.log(`    before: ${c.before.slice(0, 200)}`);
    console.log(`    after:  ${c.after.slice(0, 200)}`);
  }
  if (OUT_FILE) console.log(`   план сохранён: ${OUT_FILE}`);
  console.log('   Для записи укажи --apply --ids=<campaign ids> (только одобренные).');
}

main().catch((e) => {
  console.error('[migrate-global-prompt-socials] ошибка:', e?.message || e);
  process.exit(1);
});
