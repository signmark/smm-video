/**
 * SM-32. Одно описание того, какие размеры умеет каждая модель генерации.
 *
 * ЗАЧЕМ. Список размеров в интерфейсе был один на все модели. Человек выбирал
 * 768x1024, а gpt-image-2 таких размеров не умеет вовсе — она отдаёт только
 * 1024x1024, 1536x1024 и 1024x1536. Мы молча подставляли ближайший по
 * ориентации, и приходило 1024x1536: ориентация верная, числа другие, и нигде
 * об этом не сказано.
 *
 * Решение владельца 18.08: «если у модели всего 3 размера, то их надо
 * подставлять в дропдаун при выборе этой модели», «всё должно быть в
 * соответствии с возможностями интеграций или честно писать, почему не можем».
 *
 * ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ. Отсюда берут и сервер (какие поля слать в fal,
 * см. server/services/fal-size-params.ts), и клиент (что показать в списке).
 * Раньше это знание было размазано: в сервере — форма параметров, в клиенте —
 * список из пяти размеров, ни один не знал про другой. Добавление модели
 * делается ЗДЕСЬ, и интерфейс меняется без правок в клиенте.
 *
 * Сверено со схемой fal 18.08.2026.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** Размер с подписью — то, что видно в списке. */
export interface ImageSizeOption extends ImageSize {
  /** Например «1536x1024 (Альбомная)». */
  label: string;
}

export type SizeCapability =
  /**
   * Модель принимает РОВНО перечисленные размеры. Ничего другого выбрать
   * нельзя — иначе получится подмена за спиной у человека.
   */
  | { kind: 'fixed'; sizes: ImageSizeOption[]; note: string }
  /**
   * Модель работает соотношением сторон, а не пикселями. Числа в списке
   * остаются как ориентир, но выбирать можно только поддерживаемые
   * соотношения, а точные пиксели модель определит сама.
   */
  | { kind: 'aspect'; ratios: string[]; note: string }
  /** Произвольные размеры — список сужать не за что. */
  | { kind: 'free' };

/** Соотношения, которые понимает nano-banana (Gemini image через fal). */
export const NANO_BANANA_RATIOS = [
  '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16',
];

/** Три размера gpt-image-2 — ровно то, что отдаёт модель. */
export const GPT_IMAGE_SIZES: ImageSizeOption[] = [
  { width: 1024, height: 1024, label: '1024x1024 (Квадрат)' },
  { width: 1536, height: 1024, label: '1536x1024 (Альбомная)' },
  { width: 1024, height: 1536, label: '1024x1536 (Портретная)' },
];

/**
 * Возможности модели по её идентификатору.
 *
 * Сопоставление по подстроке — ровно как в resolveSizeParams: идентификатор
 * приходит в разном виде ('schnell', 'fal-ai/fast-sdxl', 'openai/gpt-image-2'),
 * и точное сравнение здесь уже ломалось.
 *
 * Неизвестная модель — 'free'. Это осознанно: сузить список модели, про
 * которую мы ничего не знаем, значит отнять у человека рабочие размеры на
 * основании догадки.
 */
export function getSizeCapability(modelId: string): SizeCapability {
  const id = String(modelId || '').toLowerCase();

  if (id.includes('gpt-image')) {
    return {
      kind: 'fixed',
      sizes: GPT_IMAGE_SIZES,
      note: 'Модель отдаёт только три размера — других вариантов у неё нет.',
    };
  }

  if (id.includes('nano-banana')) {
    return {
      kind: 'aspect',
      ratios: NANO_BANANA_RATIOS,
      note: 'Модель задаёт картинку соотношением сторон: числа приблизительные, соотношение точное.',
    };
  }

  // fooocus (кратность 8), schnell, fast-sdxl, sdxl, flux/*, juggernaut,
  // прямой Gemini — произвольные размеры.
  return { kind: 'free' };
}

/** Соотношение сторон в виде «W:H» с сокращением на НОД — '1024x768' → '4:3'. */
export function ratioOf({ width, height }: ImageSize): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

/**
 * Список размеров для интерфейса при выбранной модели.
 *
 * `baseOptions` — общий список (ASPECT_RATIOS). Для 'free' он возвращается как
 * есть: сужение не должно задевать модели, которые умеют больше.
 */
export function sizeOptionsForModel(
  modelId: string,
  baseOptions: ImageSizeOption[],
): ImageSizeOption[] {
  const capability = getSizeCapability(modelId);

  if (capability.kind === 'fixed') return capability.sizes;

  if (capability.kind === 'aspect') {
    const supported = baseOptions.filter((option) => capability.ratios.includes(ratioOf(option)));
    // Если общий список вдруг не пересёкся с возможностями модели, лучше
    // показать его целиком, чем пустой список: пустой выбор — это тупик.
    return supported.length > 0 ? supported : baseOptions;
  }

  return baseOptions;
}

/** Подпись под полем: чем ограничена модель. Пусто — ограничений нет. */
export function sizeNoteForModel(modelId: string): string {
  const capability = getSizeCapability(modelId);
  return capability.kind === 'free' ? '' : capability.note;
}

/**
 * Ближайший допустимый размер при смене модели.
 *
 * Ориентация важнее чисел: человек просил портрет — получит портрет. Внутри
 * одной ориентации берём ближайший по соотношению сторон.
 */
export function nearestAllowedSize(
  modelId: string,
  current: ImageSize,
  baseOptions: ImageSizeOption[],
): ImageSizeOption {
  const options = sizeOptionsForModel(modelId, baseOptions);
  const exact = options.find((o) => o.width === current.width && o.height === current.height);
  if (exact) return exact;

  const orientation = (s: ImageSize) => Math.sign(s.width - s.height);
  const wanted = orientation(current);
  const sameOrientation = options.filter((o) => orientation(o) === wanted);
  const pool = sameOrientation.length > 0 ? sameOrientation : options;

  const wantedRatio = current.width / Math.max(1, current.height);
  return pool.reduce((best, option) => {
    const diff = Math.abs(option.width / option.height - wantedRatio);
    const bestDiff = Math.abs(best.width / best.height - wantedRatio);
    return diff < bestDiff ? option : best;
  }, pool[0]);
}

/**
 * Что показать в поле «Размер» после выбора модели.
 *
 * `replaced` = true, когда прежний выбор новой модели недоступен: интерфейс
 * обязан сказать об этом словами, иначе подмена снова окажется молчаливой —
 * ровно тот дефект, из-за которого заведена SM-32.
 */
export function resolveSizeSelection(
  modelId: string,
  current: ImageSize,
  baseOptions: ImageSizeOption[],
): { options: ImageSizeOption[]; selected: ImageSizeOption; replaced: boolean; note: string } {
  const options = sizeOptionsForModel(modelId, baseOptions);
  const selected = nearestAllowedSize(modelId, current, baseOptions);
  return {
    options,
    selected,
    replaced: selected.width !== current.width || selected.height !== current.height,
    note: sizeNoteForModel(modelId),
  };
}
