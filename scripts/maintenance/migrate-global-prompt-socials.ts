/**
 * SM-18: разовая миграция legacy-промтов — сводит литеральные названия
 * НЕподключённых соцсетей в `autonomous_settings.globalPrompt` к переменной
 * `[socialNetworks]`.
 *
 * ЗАЧЕМ. Промты, сгенерированные старым «Конфигуратором ассистента» до фикса
 * SM-18, уже сохранены в базе и содержат «...пользователи Facebook» и т.п.
 * Починка генератора старые тексты не трогает. Этот скрипт — то безопасное,
 * явно ограниченное действие, о котором просил ревью (@Codex_HM): он НЕ
 * перегенерирует текст (не затирает ручные правки) и НЕ меняет смысл отрицаний
 * («не использовать Facebook» останется как есть).
 *
 * Правило замены ровно такое же, как в рантайм-подстановке
 * server/services/social-prompt.ts (normalizePlatformMentionsToPlaceholder):
 * подставляемая сеть должна быть НЕ подключена к кампании, а упоминание — вне
 * отрицающего контекста. Подключённые сети и отрицания не трогаем.
 *
 * БЕЗОПАСНОСТЬ. По умолчанию dry-run: ничего не пишет. Запись — явным флагом
 * --apply. Перед --apply сделать бэкап user_campaigns.
 *
 * Использование:
 *   # 1) посмотреть, что будет заменено (ничего не меняет)
 *   DIRECTUS_URL=... DIRECTUS_TOKEN=... npx tsx scripts/maintenance/migrate-global-prompt-socials.ts
 *
 *   # 2) применить
 *   DIRECTUS_URL=... DIRECTUS_TOKEN=... npx tsx scripts/maintenance/migrate-global-prompt-socials.ts --apply
 */

import axios from 'axios';
import { normalizePlatformMentionsToPlaceholder } from '../../server/services/social-prompt';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN =
  process.env.DIRECTUS_TOKEN ||
  process.env.DIRECTUS_SERVICE_TOKEN ||
  process.env.DIRECTUS_ADMIN_TOKEN;

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 100;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.error('[migrate-global-prompt-socials] Требуются DIRECTUS_URL и DIRECTUS_TOKEN');
  process.exit(1);
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

async function main() {
  let offset = 0;
  let scanned = 0;
  let changed = 0;

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
      if (!settings || typeof settings.globalPrompt !== 'string') {
        // и под нижним регистром global_prompt для перестраховки
        if (typeof (settings as any)?.global_prompt !== 'string') continue;
      }
      const prompt = typeof settings.globalPrompt === 'string'
        ? settings.globalPrompt
        : String((settings as any).global_prompt || '');

      const normalized = normalizePlatformMentionsToPlaceholder(prompt);

      if (normalized !== prompt) {
        changed += 1;
        console.log(
          `[migrate-global-prompt-socials] campaign ${row.id}: globalPrompt меняется`,
          APPLY ? '(APPLY)' : '(dry-run, см. --apply)',
        );
        if (APPLY) {
          const next = { ...settings, globalPrompt: normalized };
          await axios.patch(
            `${DIRECTUS_URL}/items/user_campaigns/${row.id}`,
            { autonomous_settings: JSON.stringify(next) },
            { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } },
          );
        }
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(
    `[migrate-global-prompt-socials] сканировано кампаний: ${scanned}; промтов к замене: ${changed}`,
  );
}

main().catch((e) => {
  console.error('[migrate-global-prompt-socials] ошибка:', e?.message || e);
  process.exit(1);
});
