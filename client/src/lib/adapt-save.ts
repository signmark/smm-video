/**
 * SM-35. Состояние кнопки сохранения в окне адаптации и чтение уже сохранённых
 * текстов.
 *
 * Раньше здесь жила заглушка (`adapt-stub`): сохранение не было сделано, и
 * кнопка всегда стояла выключенной с подписью «Скоро появится». Теперь
 * сохранение настоящее, и правило простое: кнопка доступна, когда выбрана хотя
 * бы одна площадка.
 */

export interface AdaptSaveState {
  disabled: boolean;
  label: string;
}

export function adaptSaveState(input: {
  saving: boolean;
  anyPlatformEnabled: boolean;
}): AdaptSaveState {
  if (input.saving) {
    return { disabled: true, label: 'Сохранение...' };
  }
  return { disabled: !input.anyPlatformEnabled, label: 'Сохранить' };
}

/**
 * Достаёт сохранённые тексты по площадкам из записи контента.
 *
 * Пустые и не-строковые значения отбрасываем: пустой текст — это «не
 * заполнено», и подставлять его вместо свежей адаптации нельзя.
 */
export function savedPlatformTexts(
  socialPlatforms: Record<string, any> | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!socialPlatforms || typeof socialPlatforms !== 'object') return result;
  for (const [platform, value] of Object.entries(socialPlatforms)) {
    if (!value || typeof value !== 'object') continue;
    const caption = (value as any).caption;
    if (typeof caption === 'string' && caption.trim()) result[platform] = caption;
  }
  return result;
}
