/**
 * Asserts that every i18n key referenced by an aria-label/title in the
 * components this PR touched actually exists in ru.json, en.json and
 * es.json. Prevents regressions like CL-02 where
 * \`t('topbar.autonomous.startLabel')\` was used while the keys were
 * added under \`nav.autonomous.*\` — i18next silently returned the key
 * itself, the screen reader announced "topbar autonomous startLabel"
 * and the title was equally broken.
 */
import { describe, expect, it } from 'vitest';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

type JsonObject = { [key: string]: unknown };

function lookupPath(root: JsonObject, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as JsonObject)) {
      return (acc as JsonObject)[segment];
    }
    return undefined;
  }, root);
}

const KEY_PATHS = [
  // CL-02: Topbar autonomous toggle
  'nav.autonomous.startLabel',
  'nav.autonomous.stopLabel',
  'nav.autonomous.pendingLabel',
  // Task 8: SupportChat floating button
  'support.openLabel',
  'support.closeLabel',
  // Task 8: CampaignsTable more-actions menu
  'campaigns.actionsMenuLabel',
  // Task 7: Calendar nav buttons
  'publishing.published.calendarPrevMonth',
  'publishing.published.calendarNextMonth',
  'publishing.published.calendarMonth',
  'publishing.published.calendarYear',
  // F-02: shared UI labels
  'ui.retry',
  'ui.loading',
  'ui.errorTitle',
  'ui.retryingPost',
  'ui.campaignSwitching.title',
  'ui.campaignSwitching.subtitle',
  // F-02: page-specific labels
  'publishing.published.errorTitle',
  'publishing.published.undatedTitle',
  'publishing.published.undatedDescription',
  'publishing.published.failedSection.title',
  'publishing.published.failedSection.description',
  'publishing.scheduled.errorTitle',
  'publishing.scheduled.overdueSection.title',
  'publishing.scheduled.overdueSection.description',
  'content.error.title',
  'auth.recovery.explanation',
  'auth.recovery.logoutButton',
  'auth.recovery.loggingOut',
  // Топбар: раньше эти подписи были захардкожены по-русски и не реагировали
  // на переключатель языка
  'topbar.menuExpand',
  'topbar.menuCollapse',
  'topbar.language',
  'topbar.aiAssistant',
  'topbar.tgAssistant',
  'topbar.pricing',
  'topbar.smmAdmin',
  'topbar.autonomous.withImages',
  'topbar.autonomous.pendingTitle',
  'topbar.autonomous.pendingDescription',
  'topbar.autonomous.activeTitle',
  'topbar.autonomous.activeHint',
  'topbar.autonomous.stats',
  'topbar.autonomous.quotaTitle',
  'topbar.autonomous.quotaHint',
  'topbar.autonomous.offTitle',
  'topbar.autonomous.offHint',
  'topbar.pipelineDialog.title',
  'topbar.pipelineDialog.description',
  'topbar.pipelineDialog.start',
  'topbar.pipelineDialog.starting',
  ...['fullAuto', 'mixed', 'controlled'].flatMap((mode) => [
    `topbar.pipelineDialog.modes.${mode}.title`,
    `topbar.pipelineDialog.modes.${mode}.description`,
    `topbar.pipelineDialog.modes.${mode}.badge`,
  ]),
  // Селектор кампании в топбаре
  'campaigns.selectorLabel',
  'campaigns.selectPlaceholder',
  'campaigns.loadingList',
  'campaigns.noActive',
  'campaigns.loadError',
];

/**
 * Плюрализация «пост/поста/постов» отдана i18next, поэтому ключ существует
 * только в виде суффиксов. Проверяем per-locale: у ru четыре формы, у en две.
 */
const PLURAL_KEYS: Record<string, string[]> = {
  ru: ['topbar.autonomous.schedule_one', 'topbar.autonomous.schedule_few', 'topbar.autonomous.schedule_many'],
  en: ['topbar.autonomous.schedule_one', 'topbar.autonomous.schedule_other'],
  es: ['topbar.autonomous.schedule_one', 'topbar.autonomous.schedule_other'],
};

describe('i18n keys referenced by aria-labels exist in all locales', () => {
  it.each(KEY_PATHS)('%s is present in ru.json, en.json, es.json', (key) => {
    for (const [name, dict] of [
      ['ru', ru],
      ['en', en],
      ['es', es],
    ] as const) {
      const value = lookupPath(dict as unknown as JsonObject, key);
      expect(value, `key ${key} missing in ${name}.json`).toBeDefined();
      expect(typeof value, `key ${key} in ${name}.json is not a string`).toBe('string');
      expect((value as string).length, `key ${key} in ${name}.json is empty`).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(PLURAL_KEYS))('%s has every plural form of the autonomous schedule', (name, keys) => {
    const dict = ({ ru, en, es } as Record<string, unknown>)[name] as JsonObject;
    for (const key of keys) {
      const value = lookupPath(dict, key);
      expect(typeof value, `plural key ${key} missing in ${name}.json`).toBe('string');
    }
  });
});
