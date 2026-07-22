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
];

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
});
