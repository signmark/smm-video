/**
 * Разовый досчёт published_at для контента со статусом 'published' и пустой датой.
 *
 * ЗАЧЕМ. Часть путей публикации проставляла статус, но не дату (см. фикс в
 * publish-scheduler / mark-as-published / вебхуке статусов). Такие записи молча
 * выпадают из любых разрезов по времени: «График активности за 30 дней»,
 * экспорт отчётов. Счётчик «всего опубликовано» при этом остаётся верным —
 * расходятся именно разрезы.
 *
 * ЧТО ВОССТАНАВЛИВАЕТСЯ ДОСТОВЕРНО. Только записи, где хотя бы одна платформа
 * в social_platforms несёт свой publishedAt. Берём максимум по платформам —
 * ровно так же, как это делает getPublishedPlatformTimeSummary, то есть дата
 * будет согласована с тем, что показывает карточка поста.
 *
 * ЧТО НЕ ВОССТАНАВЛИВАЕТСЯ. Если ни одна платформа даты не несёт, честного
 * источника нет. date_updated — это время ЛЮБОЙ последней правки записи
 * (редактирование текста, пересчёт статуса, миграция), а не время публикации.
 * Записать его в published_at — значит нарисовать в аналитике ложные всплески
 * в дни, когда на самом деле ничего не публиковалось. Такие записи скрипт
 * НЕ трогает и только пересчитывает в отчёте.
 *
 * БЕЗОПАСНОСТЬ. По умолчанию режим dry-run: ничего не пишет, только печатает
 * план. Запись включается явным флагом --apply.
 *
 * Использование:
 *   # 1) сначала посмотреть, что вообще есть (ничего не меняет)
 *   DIRECTUS_URL=... DIRECTUS_TOKEN=... npx tsx scripts/maintenance/backfill-published-at.ts
 *
 *   # 2) применить только достоверную часть
 *   DIRECTUS_URL=... DIRECTUS_TOKEN=... npx tsx scripts/maintenance/backfill-published-at.ts --apply
 *
 * Перед --apply сделать бэкап campaign_content.
 */

import axios from 'axios';
import { getPublishedPlatformTimeSummary } from '../../shared/schedule-time';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN =
  process.env.DIRECTUS_TOKEN ||
  process.env.DIRECTUS_SERVICE_TOKEN ||
  process.env.DIRECTUS_ADMIN_TOKEN;

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 100;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.error('Нужны DIRECTUS_URL и DIRECTUS_TOKEN (или DIRECTUS_SERVICE_TOKEN / DIRECTUS_ADMIN_TOKEN)');
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${DIRECTUS_TOKEN}` };

interface Row {
  id: string;
  status: string;
  published_at: string | null;
  social_platforms: Record<string, any> | string | null;
}

function parsePlatforms(raw: Row['social_platforms']): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

async function fetchBrokenRows(): Promise<Row[]> {
  const rows: Row[] = [];
  let page = 1;

  for (;;) {
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      headers: authHeaders,
      params: {
        // Оба поля существуют в campaign_content и читаются админ-токеном
        // в проде (те же имена использует server/routes/content.ts).
        filter: JSON.stringify({
          _and: [{ status: { _eq: 'published' } }, { published_at: { _null: true } }],
        }),
        // date_updated намеренно НЕ запрашивается: он не нужен для расчёта
        // (см. шапку), а лишнее поле в запросе — лишний риск 403 на роли,
        // у которой его нет в разрешениях.
        fields: 'id,status,published_at,social_platforms',
        limit: PAGE_SIZE,
        page,
      },
    });

    const batch: Row[] = response.data?.data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

async function main() {
  console.log(`Режим: ${APPLY ? 'ЗАПИСЬ (--apply)' : 'dry-run (только отчёт)'}`);

  const rows = await fetchBrokenRows();
  console.log(`Найдено записей status='published' с пустым published_at: ${rows.length}`);

  const recoverable: Array<{ id: string; publishedAt: string }> = [];
  const unrecoverable: Row[] = [];

  for (const row of rows) {
    const platforms = parsePlatforms(row.social_platforms);
    const summary = getPublishedPlatformTimeSummary(platforms);

    if (summary.publishedAt) {
      recoverable.push({ id: row.id, publishedAt: summary.publishedAt });
    } else {
      unrecoverable.push(row);
    }
  }

  console.log(`  восстановимо по датам платформ: ${recoverable.length}`);
  console.log(`  достоверного источника нет:     ${unrecoverable.length}`);

  if (unrecoverable.length > 0) {
    console.log(
      '\nЗаписи без даты ни на одной платформе остаются как есть.\n' +
        'date_updated здесь НЕ подходит: это время последней любой правки,\n' +
        'подстановка исказит график активности. Список id (первые 20):',
    );
    console.log(unrecoverable.slice(0, 20).map((row) => row.id).join('\n'));
  }

  if (!APPLY) {
    console.log('\nDry-run: ничего не записано. Для применения — флаг --apply.');
    console.log('Примеры того, что было бы записано (первые 10):');
    for (const item of recoverable.slice(0, 10)) {
      console.log(`  ${item.id} -> ${item.publishedAt}`);
    }
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const item of recoverable) {
    try {
      await axios.patch(
        `${DIRECTUS_URL}/items/campaign_content/${item.id}`,
        { published_at: item.publishedAt },
        { headers: authHeaders },
      );
      updated += 1;
      if (updated % 25 === 0) console.log(`  обновлено ${updated}/${recoverable.length}`);
    } catch (error: any) {
      failed += 1;
      console.error(`  ОШИБКА ${item.id}: ${error.response?.status || ''} ${error.message}`);
    }
  }

  console.log(`\nГотово. Обновлено: ${updated}, ошибок: ${failed}, пропущено как невосстановимые: ${unrecoverable.length}`);
}

main().catch((error) => {
  console.error(`Фатальная ошибка: ${error.message}`);
  process.exit(1);
});
