/**
 * AI-118 (2026-08-17): выбор стратегии отдачи фронта НА СТАРТЕ, до server.listen().
 *
 * В production отсутствие собранного фронта (dist/public) — fail-closed: бросаем error ДО того,
 * как /health начнёт отвечать, чтобы скрипт выкатки увидел «не встал» и откатил предыдущий.
 * Vite dev-server fallback допускается ТОЛЬКО в development.
 *
 * Отделён в отдельный модуль, чтобы поведение можно было тестировать без подъёма всего
 * серверного entrypoint (server/index.ts в изоляции не импортируется — side effects + конфликты).
 */
export type FrontendStaticStrategy =
  | { kind: 'serve_static'; distPath: string }
  | { kind: 'dev_vite_fallback'; distPath: string };

export function resolveFrontendStaticStrategy(
  isProduction: boolean,
  distPath: string,
  distExists: boolean,
): FrontendStaticStrategy {
  if (isProduction) {
    if (!distExists) {
      // Fail-closed: никогда не поднимаем vite dev-server в production. Имя пути — первым, чтобы
      // дежурный ночью понял причину с первой строки, не читая код.
      throw new Error(
        `[AI-118 fail-closed] Production frontend build missing at ${distPath} ` +
          `(dist/public): запуск остановлен до server.listen(). ` +
          `Vite dev-server в production НЕ поднимается. Проверьте выкладку/build.`,
      );
    }
    return { kind: 'serve_static', distPath };
  }
  // development: если сборки нет, разрешаем vite dev-server.
  return distExists ? { kind: 'serve_static', distPath } : { kind: 'dev_vite_fallback', distPath };
}
