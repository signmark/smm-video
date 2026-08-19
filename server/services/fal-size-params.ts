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
 *   image_size:{width,height}  — openai/gpt-image-2 ЧЕРЕЗ FAL
 *
 * SM-31 (сверено со схемой fal 2026-08-18). Здесь раньше стояло, что gpt-image
 * ждёт OpenAI-поле size — и клиент так и слал. У fal-эндпоинта openai/gpt-image-2
 * поля size нет вовсе: он ждёт image_size, а неизвестные поля молча отбрасывает и
 * берёт СВОЙ дефолт image_size = landscape_4_3. Поэтому выбранный размер
 * игнорировался, и картинка всегда выходила 4:3. Прямой путь в OpenAI (не через
 * fal) по-прежнему пользуется полем size — это другой вызов, он в порядке.
 *
 * Отдаём ТОЛЬКО поле(я), которые модель реально понимает — без «слать всё и пусть
 * игнорируют» (часть fal-эндпоинтов строго валидируют вход и вернут 422).
 *
 * SM-32. Сам перечень возможностей («три размера у gpt-image», «соотношения у
 * nano-banana») переехал в shared/image-size-capabilities.ts — туда же смотрит
 * список размеров в интерфейсе. Здесь остаётся только ФОРМА параметров: какое
 * поле и в каком виде ждёт конкретный fal-эндпоинт. Пока перечень жил здесь,
 * клиент про него не знал и предлагал размеры, которых модель не умеет.
 */
import {
  GPT_IMAGE_SIZES,
  NANO_BANANA_RATIOS,
  nearestAllowedSize,
} from '@shared/image-size-capabilities';

function roundToMultiple(n: number, mult: number): number {
  const v = Math.round((Number(n) || 0) / mult) * mult;
  return Math.max(mult, v);
}

/** Ближайший из поддерживаемых nano-banana аспектов к заданным w:h. */
const NANO_ASPECTS: Array<{ label: string; value: number }> = NANO_BANANA_RATIOS.map((label) => {
  const [w, h] = label.split(':').map(Number);
  return { label, value: w / h };
});

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

  // gpt-image через fal — image_size, но только из трёх размеров, которые модель
  // умеет (перечень в общем описании возможностей). Произвольные width/height она
  // не отдаст, поэтому берём ближайший допустимый: человек просил портрет —
  // получит портрет. SM-32: в интерфейсе этих трёх размеров теперь и не обойти,
  // но старые запросы и автономный режим сюда всё ещё приходят с любыми числами.
  if (id.includes('gpt-image')) {
    const { width, height } = nearestAllowedSize(id, { width: w, height: h }, GPT_IMAGE_SIZES);
    return { image_size: { width, height } };
  }

  // Всё остальное (schnell, fast-sdxl, sdxl, flux-lora, juggernaut, flux/*, дефолт)
  // — image_size как объект {width,height}. Кратность 8 безопасна для всех.
  return { image_size: { width: w, height: h } };
}
