/**
 * SM-20, фаза 2 (B). Пауза и выключение снимают с публикации то, что этот же
 * запуск автономного режима и запланировал.
 *
 * До сих пор пауза гасила таймеры и на этом заканчивалась: уже запланированные
 * посты оставались в очереди и выходили сами, пока человек думал, что режим
 * стоит. Тестировщик поймал это на проде.
 *
 * Принадлежность НЕ вычисляется эвристикой и не хранится отдельным полем в
 * `campaign_content`. Она уже есть: реестр `autonomous_cycle_items` пишет строку
 * на каждый слот цикла ещё до обращения к модели и хранит `run_id`, `cycle_id`,
 * `campaign_id`, `user_id` и `content_id`. Публикация принадлежит запуску тогда
 * и только тогда, когда у неё есть такая строка. Отсюда три свойства, которые
 * не нужно проверять фильтром — их не может нарушить ни один запрос:
 *   • ручная публикация не имеет строки в реестре вовсе;
 *   • публикация чужого запуска имеет строку с другим `run_id`;
 *   • старые публикации, созданные до появления реестра, строк не имеют.
 *
 * Арендатор проверяется явно, а не подразумевается: строка обязана совпасть по
 * `campaign_id` И `user_id`. Совпадения одного `run_id` мало — идентификатор
 * запуска приходит из состояния в памяти, и граница арендатора не должна
 * зависеть от того, что это состояние не испорчено.
 *
 * Гонка с публикатором закрыта не проверкой статуса, а той же блокировкой,
 * которой пользуется сам публикатор (`publication_locks`). Проверка статуса
 * оставляет окно между «прочитали» и «записали»; общая блокировка не оставляет:
 *   • публикатор успел взять блокировку — пауза до строки не дотягивается и
 *     честно сообщает, что публикация уже идёт. Именно этого требует правило
 *     «не откатывать уже взятую строку»;
 *   • пауза взяла блокировку первой — публикатор не проходит собственную
 *     проверку блокировки и до отправки не доходит.
 *
 * Ноль подходящих строк — это успех, а не ошибка: у запуска могло не быть
 * запланированных публикаций. А вот строка, которая была подходящей при чтении,
 * но не обновилась при записи, успехом не считается: её кто-то увёл, и человек
 * должен об этом узнать, а не увидеть «готово».
 */

/** Строка реестра слотов цикла. */
export interface CycleSlotRow {
  itemKey: string;
  itemIndex: number;
  cycleId: string | null;
  campaignId: string | null;
  userId: string | null;
  state: string;
  contentId: string | null;
}

/** Слот, принадлежность которого этому запуску и арендатору подтверждена. */
export interface OwnedSlot {
  itemKey: string;
  itemIndex: number;
  cycleId: string | null;
  contentId: string;
}

export interface DemotionOwner {
  runId: string;
  campaignId: string;
  userId: string;
}

export interface DemotionCounts {
  /** слоты запуска, у которых есть созданная публикация */
  owned: number;
  /** из них публикации, которые на момент чтения стояли в очереди */
  eligible: number;
  /** переведены в черновики */
  demoted: number;
  /** были подходящими при чтении, но условное обновление не сработало */
  contested: number;
  /** публикатор держит блокировку — оставлены как есть */
  busy: number;
  /** уже черновик: слот дозакрыт после прерванного прошлого раза */
  reconciled: number;
  /** уже опубликовано или иной статус — не наше дело */
  skipped: number;
  /** отказ обращения к хранилищу */
  failed: number;
}

export function emptyCounts(): DemotionCounts {
  return { owned: 0, eligible: 0, demoted: 0, contested: 0, busy: 0, reconciled: 0, skipped: 0, failed: 0 };
}

/**
 * Отбор строк реестра, принадлежащих ровно этому запуску этого арендатора.
 *
 * Слот без `content_id` (состояние `reserved`) пропускается: публикации ещё нет,
 * снимать нечего. Слот в `consumed`/`tombstone` пропускается: он уже закрыт.
 */
export function ownedSlots(rows: CycleSlotRow[], owner: DemotionOwner): OwnedSlot[] {
  return rows
    .filter((row) => row.state === 'filled')
    .filter((row) => typeof row.contentId === 'string' && row.contentId.length > 0)
    .filter((row) => row.campaignId === owner.campaignId && row.userId === owner.userId)
    .map((row) => ({
      itemKey: row.itemKey,
      itemIndex: row.itemIndex,
      cycleId: row.cycleId,
      contentId: row.contentId as string,
    }));
}

/** Площадки публикации: блокировку берём по каждой, как это делает публикатор. */
export function platformsOf(socialPlatforms: unknown): string[] {
  if (!socialPlatforms || typeof socialPlatforms !== 'object' || Array.isArray(socialPlatforms)) return [];
  return Object.keys(socialPlatforms as Record<string, unknown>);
}

export interface DemotionDeps {
  /** Строки реестра по идентификатору запуска. NULL — реестр недоступен. */
  listRunSlots(runId: string): Promise<CycleSlotRow[] | null>;
  /** Текущие статусы публикаций. Отсутствующие в ответе считаются удалёнными. */
  readContent(ids: string[]): Promise<Array<{ id: string; status: string | null; social_platforms?: unknown }>>;
  /** Блокировка публикации по каждой площадке. false — публикатор уже держит её. */
  acquireLocks(contentId: string, platforms: string[]): Promise<boolean>;
  releaseLocks(contentId: string): Promise<void>;
  /** Условный перевод очереди в черновик. Возвращает число изменённых строк. */
  demote(contentId: string): Promise<number>;
  /** Условное закрытие слота реестра. */
  consume(slot: OwnedSlot): Promise<boolean>;
}

/**
 * Снимает с очереди публикации текущего запуска.
 *
 * Просроченные не выделяются в особый случай намеренно: они точно так же стоят
 * в очереди и точно так же выйдут при первом же проходе планировщика. Отдельное
 * условие по времени только оставило бы дыру.
 */
export async function demoteRunScheduledContent(
  owner: DemotionOwner,
  deps: DemotionDeps,
): Promise<DemotionCounts> {
  const counts = emptyCounts();

  const rows = await deps.listRunSlots(owner.runId);
  if (rows === null) {
    counts.failed = 1;
    return counts;
  }

  const slots = ownedSlots(rows, owner);
  counts.owned = slots.length;
  if (slots.length === 0) return counts;

  const content = await deps.readContent(slots.map((slot) => slot.contentId));
  const byId = new Map(content.map((item) => [item.id, item]));

  for (const slot of slots) {
    const item = byId.get(slot.contentId);

    // Публикацию удалили — снимать нечего, и слот трогать нельзя: правило
    // «удалённое не создаём заново» держится именно на нетронутой строке.
    if (!item) {
      counts.skipped++;
      continue;
    }

    if (item.status === 'draft') {
      // Прошлый раз успел перевести публикацию, но не успел закрыть слот.
      // Черновик не публикуется, поэтому закрыть слот безопасно и правильно.
      if (await deps.consume(slot)) counts.reconciled++;
      else counts.skipped++;
      continue;
    }

    if (item.status !== 'scheduled') {
      counts.skipped++;
      continue;
    }

    counts.eligible++;

    const platforms = platformsOf(item.social_platforms);
    let locked = false;
    try {
      locked = await deps.acquireLocks(slot.contentId, platforms);
      if (!locked) {
        counts.busy++;
        continue;
      }

      const affected = await deps.demote(slot.contentId);
      if (affected === 0) {
        // Строка была подходящей при чтении и перестала быть к моменту записи.
        counts.contested++;
        continue;
      }

      counts.demoted++;
      await deps.consume(slot);
    } catch {
      counts.failed++;
    } finally {
      if (locked) await deps.releaseLocks(slot.contentId);
    }
  }

  return counts;
}

/**
 * Человеческий и машинный итог. Успехом считается только отсутствие спорных
 * строк и отказов: «ничего не нашлось» — успех, «нашлось, но увели» — нет.
 */
export function demotionOutcome(counts: DemotionCounts): {
  success: boolean;
  conflicts: number;
  message: string;
} {
  const conflicts = counts.contested + counts.busy + counts.failed;

  if (counts.failed > 0) {
    return { success: false, conflicts, message: 'Не удалось снять публикации с очереди — хранилище не ответило' };
  }
  if (counts.contested > 0 || counts.busy > 0) {
    const parts: string[] = [];
    if (counts.demoted > 0) parts.push(`снято с очереди: ${counts.demoted}`);
    if (counts.busy > 0) parts.push(`уже публикуется: ${counts.busy}`);
    if (counts.contested > 0) parts.push(`изменено параллельно: ${counts.contested}`);
    return { success: false, conflicts, message: `Снято не всё — ${parts.join(', ')}` };
  }
  if (counts.demoted === 0) {
    return { success: true, conflicts: 0, message: 'Запланированных публикаций этого запуска не было' };
  }
  return { success: true, conflicts: 0, message: `Снято с очереди публикаций: ${counts.demoted}` };
}
