/**
 * Нормализация идентификатора сообщества VK.
 *
 * В `socialMediaSettings.vk.groupId` исторически попадают четыре разные формы —
 * форма зависит от того, каким мастером подключали кампанию:
 *   `-176171231`, `176171231`, `club226440032`, `https://vk.com/avtocargo_pro03`.
 *
 * VK API при этом ждёт две разные вещи от одного и того же сообщества:
 *   - `groups.getById` — ПОЛОЖИТЕЛЬНЫЙ id или screen_name (на `-176171231`
 *     отвечает ошибкой 100 «group_id should be greater than 0»);
 *   - `wall.post` — ОТРИЦАТЕЛЬНЫЙ owner_id.
 *
 * Пока нормализации не было, `validateVkToken` отдавал в `groups.getById`
 * сохранённое значение как есть: у кампании с `-176171231` живой админский
 * токен получал ошибку 100, вся проверка помечалась провалом, и карточка в UI
 * уезжала в «Требует переподключения» — при полностью рабочей публикации.
 */

/** Убирает обвязку вокруг идентификатора: URL, префиксы `club`/`public`/`event`. */
function stripDecoration(raw: string): string {
  let value = raw.trim();

  // https://vk.com/club176171231, vk.com/avtocargo_pro03, m.vk.com/... → хвост пути
  const urlMatch = value.match(/(?:^https?:\/\/)?(?:[\w-]+\.)?vk\.(?:com|ru)\/([^/?#]+)/i);
  if (urlMatch) {
    value = urlMatch[1];
  }

  // club176171231 / public176171231 / event176171231 → 176171231.
  // Только если после префикса одни цифры: `clubhouse_msk` — это screen_name.
  const prefixMatch = value.match(/^(?:club|public|event)(\d+)$/i);
  if (prefixMatch) {
    value = prefixMatch[1];
  }

  return value;
}

/**
 * Приводит сохранённый groupId к виду, который принимает `groups.getById`:
 * положительный числовой id либо screen_name.
 *
 * @returns нормализованное значение или undefined, если идентификатора нет
 */
export function normalizeVkGroupId(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = stripDecoration(String(raw));
  if (!value) return undefined;

  const numeric = value.match(/^-?(\d+)$/);
  if (numeric) {
    // Ноль идентификатором сообщества быть не может — считаем его отсутствием.
    return numeric[1] === '0' ? undefined : numeric[1];
  }

  return value;
}
