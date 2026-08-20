/**
 * SM-36. Одно место, которое решает, доступна ли пользователю возможность.
 *
 * Раньше такого места не было вовсе. Доступ к анализу стиля определялся
 * сравнением почты с записанной в код строкой прямо на странице кампании
 * (`client/src/pages/campaigns/[id].tsx`), а серверный маршрут анализа не
 * проверял вообще ничего: вызвать его мог любой вошедший. То есть правило
 * жило в интерфейсе, а интерфейс — это не защита.
 *
 * Здесь правило одно и общее для сервера и интерфейса. Сегодня оно отвечает
 * ровно то же, что и раньше: возможность у владельца, у остальных её нет.
 * Когда появится тариф «Профессиональный», правится только эта функция —
 * места вызова трогать не придётся.
 *
 * Это НЕ то же самое, что `shared/feature-flags.ts`: там глобальные
 * переключатели «включена ли возможность в сборке», здесь — «доступна ли она
 * ЭТОМУ человеку».
 */

/** Возможности, доступ к которым решается персонально. */
export const PERSONAL_FEATURES = ['styleAnalysis', 'platformAdaptation'] as const;

export type PersonalFeature = (typeof PERSONAL_FEATURES)[number];

/** То немногое о пользователе, что нужно для решения. */
export interface FeatureSubject {
  email?: string | null;
}

/** Ответ на вопрос «что доступно» — в таком виде он уезжает в интерфейс. */
export type FeatureAccessMap = Record<PersonalFeature, boolean>;

/**
 * Кому возможность доступна, если ничего не настроено. Это тот же адрес, что
 * был вписан в страницу кампании, — поведение при обновлении не меняется.
 */
export const DEFAULT_FEATURE_EMAILS: readonly string[] = ['signmark@gmail.com'];

/** Почта в нашем деле не различает регистр и не терпит случайных пробелов. */
function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

/**
 * Разбирает список адресов из настроек окружения. Пустая строка, пробелы и
 * лишние запятые не должны превращаться в «пустой адрес», иначе пользователь
 * без почты внезапно получит доступ.
 */
export function parseFeatureEmails(raw: string | null | undefined): string[] {
  return (raw || '')
    .split(',')
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}

/**
 * Кому сегодня доступны персональные возможности. Список берётся из настроек
 * окружения (`FEATURE_ACCESS_EMAILS`), а если их нет — из значения по
 * умолчанию. Второй адрес владельца добавляется настройкой, без правки кода.
 */
export function allowedFeatureEmails(env?: Record<string, string | undefined>): string[] {
  const configured = parseFeatureEmails(env?.FEATURE_ACCESS_EMAILS);
  return configured.length > 0 ? configured : DEFAULT_FEATURE_EMAILS.map(normalizeEmail);
}

/**
 * Доступна ли возможность этому пользователю.
 *
 * Тариф сюда пока не входит намеренно: задача готовит основу, а не вводит
 * ограничение. Когда тариф появится, условие добавляется ЗДЕСЬ.
 */
export function hasFeatureAccess(
  subject: FeatureSubject | null | undefined,
  feature: PersonalFeature,
  env?: Record<string, string | undefined>,
): boolean {
  if (!PERSONAL_FEATURES.includes(feature)) return false;
  const email = normalizeEmail(subject?.email);
  if (!email) return false;
  return allowedFeatureEmails(env).includes(email);
}

/** Готовый ответ по всем возможностям сразу — его отдаёт профиль. */
export function featureAccessFor(
  subject: FeatureSubject | null | undefined,
  env?: Record<string, string | undefined>,
): FeatureAccessMap {
  const result = {} as FeatureAccessMap;
  for (const feature of PERSONAL_FEATURES) {
    result[feature] = hasFeatureAccess(subject, feature, env);
  }
  return result;
}
