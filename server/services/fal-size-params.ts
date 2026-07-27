/**
 * Единый маппинг «выбранный размер → правильный параметр под конкретную fal-модель».
 *
 * Причина: раньше во все fal-модели слали top-level width/height (или
 * image_width/image_height), а таких полей у моделей НЕТ — они ждут image_size
 * (объект/enum) или aspect_ratio. Fal их молча игнорировал → «выбор размерности
 * ничего не меняет». Формы параметров сверены с доками fal (2026-07):
 *
 *   image_size:{width,height}  — flux/schnell, fast-sdxl, sdxl, flux-lora,
 *                                 juggernaut-flux*, flux/*  (и дефолт для новых)
 *   aspect_ratio:"WxH"         — fooocus (кратно 8)
 *   aspect_ratio:"W:H" + resolution:1K|2K|4K — nano-banana-pro (Gemini image)
 *   size:"1024x1024|1536x1024|1024x1536"     — gpt-image (обрабатывается отдельно)
 *
 * Отдаём ТОЛЬКО поле(я), которые модель реально понимает — без «слать всё и пусть
 * игнорируют» (часть fal-эндпоинтов строго валидируют вход и вернут 422).
 */

function roundToMultiple(n: number, mult: number): number {
  const v = Math.round((Number(n) || 0) / mult) * mult;
  return Math.max(mult, v);
}

/** Ближайший из поддерживаемых nano-banana аспектов к заданным w:h. */
const NANO_ASPECTS: Array<{ label: string; value: number }> = [
  { label: '21:9', value: 21 / 9 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:2', value: 3 / 2 },
  { label: '4:3', value: 4 / 3 },
  { label: '5:4', value: 5 / 4 },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '3:4', value: 3 / 4 },
  { label: '2:3', value: 2 / 3 },
  { label: '9:16', value: 9 / 16 },
];

function nearestNanoAspect(width: number, height: number): string {
  const r = (Number(width) || 1) / (Number(height) || 1);
  let best = NANO_ASPECTS[5]; // 1:1
  let bestDiff = Infinity;
  for (const a of NANO_ASPECTS) {
    const diff = Math.abs(a.value - r);
    if (diff < bestDiff) { bestDiff = diff; best = a; }
  }
  return best.label;
}

function resolutionTier(width: number, height: number): '1K' | '2K' | '4K' {
  const max = Math.max(Number(width) || 0, Number(height) || 0);
  if (max <= 1024) return '1K';
  if (max <= 2048) return '2K';
  return '4K';
}

/**
 * Возвращает объект параметров размера под конкретную модель — для spread в тело
 * запроса. modelId — как в наших вызовах (может быть 'schnell', 'fal-ai/fast-sdxl',
 * 'rundiffusion-fal/juggernaut-flux-lora', 'fal-ai/nano-banana-pro' и т.п.).
 */
export function resolveSizeParams(
  modelId: string,
  width?: number,
  height?: number,
): Record<string, any> {
  const id = String(modelId || '').toLowerCase();
  const w = roundToMultiple(width || 1024, 8);
  const h = roundToMultiple(height || 1024, 8);

  // nano-banana / nano-banana-pro (Gemini image через fal) — aspect_ratio + resolution.
  if (id.includes('nano-banana')) {
    return { aspect_ratio: nearestNanoAspect(w, h), resolution: resolutionTier(w, h) };
  }

  // fooocus — aspect_ratio строкой "WxH" (кратно 8).
  if (id.includes('fooocus')) {
    return { aspect_ratio: `${w}x${h}` };
  }

  // Всё остальное (schnell, fast-sdxl, sdxl, flux-lora, juggernaut, flux/*, дефолт)
  // — image_size как объект {width,height}. Кратность 8 безопасна для всех.
  return { image_size: { width: w, height: h } };
}
