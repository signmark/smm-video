/**
 * Classifies errors thrown by `apiRequest` / React Query so the UI can
 * distinguish "campaign is genuinely empty" from "we couldn't load it".
 *
 * The classifier is intentionally pure and side-effect free: callers are free
 * to translate `userMessage` into the active locale and to chain additional
 * behaviour (refetch, logout, etc.) on top of the `kind` value.
 *
 * Security: `userMessage` is a fixed, pre-translated string. The original
 * server error text is exposed only via the `technicalDetail` field, which
 * callers must NOT render in the user interface.
 */
export type QueryErrorClass =
  | 'session-invalid'
  | 'session-refreshed'
  | 'session-unavailable'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'server-error'
  | 'network'
  | 'unknown';

export interface ClassifiedQueryError {
  kind: QueryErrorClass;
  /** Pre-translated (RU) message that is safe to render in the UI. */
  userMessage: string;
  /** HTTP status when known; otherwise null. */
  status: number | null;
  /** Original error text from the server. NEVER render this to end users. */
  technicalDetail: string | null;
}

const RU_MESSAGES: Record<QueryErrorClass, string> = {
  'session-invalid':
    'Сессия устарела или была завершена. Войдите заново, чтобы продолжить.',
  'session-refreshed':
    'Сессия была автоматически обновлена. Повторите запрос.',
  'session-unavailable':
    'Сервис авторизации временно недоступен. Проверьте соединение и повторите попытку.',
  forbidden: 'Нет доступа к этим данным. Выберите другую кампанию.',
  'not-found': 'Кампания или данные не найдены. Возможно, они были удалены.',
  'rate-limited':
    'Слишком много запросов. Подождите немного и повторите попытку.',
  'server-error':
    'Не удалось загрузить данные. Попробуйте ещё раз через несколько секунд.',
  network: 'Нет соединения с сервером. Проверьте интернет и повторите попытку.',
  unknown: 'Произошла непредвиденная ошибка. Попробуйте ещё раз.',
};

function readStatus(error: any): number | null {
  if (!error) return null;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.response?.status === 'number') return error.response.status;
  return null;
}

function readMessage(error: any): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  return '';
}

export function classifyQueryError(error: unknown): ClassifiedQueryError {
  const status = readStatus(error);
  const message = readMessage(error);

  // Session-specific markers attached by queryClient and refreshAuth.
  if (error && typeof error === 'object') {
    if ((error as any).authFailed) {
      return build('session-invalid', status, message);
    }
    if ((error as any).sessionChanged) {
      return build('session-invalid', status, message);
    }
    if ((error as any).tokenRefreshed) {
      return build('session-refreshed', status, message);
    }
    if ((error as any).authUnavailable) {
      return build('session-unavailable', status, message);
    }
  }

  if (status !== null) {
    if (status === 401) return build('session-invalid', status, message);
    if (status === 403) return build('forbidden', status, message);
    if (status === 404) return build('not-found', status, message);
    if (status === 429) return build('rate-limited', status, message);
    if (status >= 500) return build('server-error', status, message);
  }

  if (error instanceof TypeError && /fetch/i.test(message)) {
    return build('network', null, message);
  }

  return build('unknown', status, message);
}

function build(
  kind: QueryErrorClass,
  status: number | null,
  technicalDetail: string | null,
): ClassifiedQueryError {
  return {
    kind,
    userMessage: RU_MESSAGES[kind],
    status,
    technicalDetail: technicalDetail || null,
  };
}
