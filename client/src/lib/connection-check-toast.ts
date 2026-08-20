/**
 * SM-46: решение тоста для «Проверить сейчас» (/api/campaigns/:id/social/check).
 *
 * Раньше при 0 настроенных площадок сервер отвечал success:true с пустыми results,
 * и клиент показывал ложное «Связь есть со всеми настроенными площадками». После
 * фикса сервер при 0 настроенных площадок отвечает { success:false,
 * message:'Нет настроенных площадок для проверки', results:{} }.
 *
 * Здесь сосредоточено единственное правило показа, чтобы его можно было проверять
 * без монтирования страницы: success:false (0 настроенных) — нейтральный тост с
 * сообщением сервера; успех с failure-площадками — destructive «Нет связи: …»;
 * полный успех — default «Связь есть со всеми настроенными площадками».
 */
export function resolveConnectionCheckToast(
  data: any,
  title: (platform: string) => string = (p) => p,
): { variant: 'default' | 'destructive'; description: string } {
  // SM-46: 0 настроенных площадок — нейтральный результат, не «связь есть».
  if (data && data.success === false) {
    return { variant: 'default', description: data.message || 'Нет настроенных площадок для проверки' };
  }
  const results = data?.results || {};
  const failed = Object.entries(results)
    .filter(([, v]: any) => v && v.ok === false)
    .map(([platform]) => title(platform));
  if (failed.length) {
    return { variant: 'destructive', description: `Нет связи: ${failed.join(', ')}` };
  }
  return { variant: 'default', description: 'Связь есть со всеми настроенными площадками' };
}
