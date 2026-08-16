/**
 * Цвет маркера публикации в календаре (AI-116).
 *
 * ПОЧЕМУ ЭТОТ МОДУЛЬ ЕСТЬ. Раньше цвет точки считался по метке типа
 * (`contentType`), проставленной при создании материала. Метка расходится с
 * содержимым: замер по боевой базе 16.08 на 1868 материалах показал 258 с
 * меткой «текст с картинкой» без картинки, 137 таких же с видео внутри, 58 с
 * меткой «текст» и картинкой, 58 с меткой «текст» и видео, 46 с меткой «видео»
 * без видео. Примерно каждый третий материал светился цветом, не отвечающим
 * своему содержимому. Владелец заметил это на живом экране: пост с картинкой
 * был синим, то есть «текстовым».
 *
 * ПРАВИЛО. Цвет считается по ФАКТИЧЕСКОМУ содержимому, метка сознательно
 * игнорируется. Есть видео — «видео», есть картинка — «картинка», иначе
 * «текст». Метка не используется даже как запасной вариант: именно она и
 * врала. Материал без медиа — это текст, чем бы он ни был помечен.
 *
 * Медиа ищется и в основных полях, и в `additionalMedia`: часть материалов
 * (сторис, клипы) держит единственный файл только там.
 */

/** Что реально лежит в материале — в терминах, которые видит человек. */
export type ContentMediaKind = 'video' | 'image' | 'text';

/** Поля материала, которых достаточно для решения о цвете. */
export interface MediaBearingContent {
  imageUrl?: string | null;
  videoUrl?: string | null;
  additionalImages?: string[] | null;
  additionalVideos?: string[] | null;
  additionalMedia?: Array<{ url?: string | null; type?: string | null }> | null;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasAny(list: Array<string | null | undefined> | null | undefined): boolean {
  return Array.isArray(list) && list.some(nonEmpty);
}

/**
 * Есть ли в `additionalMedia` элемент нужного рода.
 *
 * Тип элемента там пишется по-разному (`generated_video`, `video`,
 * `generated_image`, `image`), поэтому проверяем вхождение подстроки, а не
 * равенство: перечислять все известные значения — значит гарантированно
 * пропустить следующее.
 */
function hasAdditionalMediaOfKind(
  items: MediaBearingContent['additionalMedia'],
  kind: 'video' | 'image',
): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((item) => nonEmpty(item?.url) && String(item?.type || '').includes(kind));
}

/** Что реально лежит в материале. Метка типа не участвует — это осознанно. */
export function detectMediaKind(content: MediaBearingContent | null | undefined): ContentMediaKind {
  if (!content) return 'text';

  if (
    nonEmpty(content.videoUrl)
    || hasAny(content.additionalVideos)
    || hasAdditionalMediaOfKind(content.additionalMedia, 'video')
  ) {
    return 'video';
  }

  if (
    nonEmpty(content.imageUrl)
    || hasAny(content.additionalImages)
    || hasAdditionalMediaOfKind(content.additionalMedia, 'image')
  ) {
    return 'image';
  }

  return 'text';
}

/**
 * Цвет маркера по роду содержимого.
 *
 * Значения собраны здесь одним местом намеренно: смена договорённости о цветах
 * — это правка одной таблицы, а не поиск литералов по трём календарям.
 */
export const MEDIA_KIND_DOT_COLOR: Record<ContentMediaKind, string> = {
  video: 'bg-violet-500',
  image: 'bg-yellow-500',
  text: 'bg-blue-500',
};

/**
 * Цвет неудачной публикации. Красный принадлежит ТОЛЬКО ошибке и никакому
 * роду содержимого — решение владельца от 16.08.
 *
 * До этого красный делили видео и неудачная публикация: в одном дне вставали
 * две одинаковые красные точки, и отличить «здесь видео» от «здесь не
 * опубликовалось» можно было только наведением мыши. Тревожный цвет тонул
 * среди обычных видео — то есть глушил ровно тот сигнал, ради которого его и
 * заводили. Видео переехало в фиолетовый.
 */
export const FAILED_PUBLICATION_DOT_COLOR = 'bg-red-500';

/** Человеческое название рода содержимого — для легенды и подсказок. */
export const MEDIA_KIND_LABEL: Record<ContentMediaKind, string> = {
  video: 'видео',
  image: 'картинка',
  text: 'текст',
};

export function dotColorForMediaKind(kind: ContentMediaKind): string {
  // Запасной вариант на случай неизвестного рода: материал без медиа — текст.
  // Возвращать undefined нельзя, иначе точка окажется вообще без класса цвета
  // и станет невидимой — молча, без ошибки.
  return MEDIA_KIND_DOT_COLOR[kind] ?? MEDIA_KIND_DOT_COLOR.text;
}

/** Короткий путь для call-site: материал → класс цвета. */
export function dotColorForContent(content: MediaBearingContent | null | undefined): string {
  return dotColorForMediaKind(detectMediaKind(content));
}
