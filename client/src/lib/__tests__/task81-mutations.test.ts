/**
 * task #81, критерий 4 (мутации) — source-boundary: реальные onSuccess трёх
 * мутаций (publish / edit / delete) обязаны вызывать scoped инвалидацию списка
 * campaign-content по selectedCampaignId. Парсится исходник content/index.tsx.
 *
 * Мутация-пруф: убрать строку `invalidateQueries({ queryKey:
 * ["/api/campaign-content", selectedCampaignId] })` из onSuccess любой из трёх
 * мутаций → соответствующий тест падает (два соседних остаются зелёными).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../../pages/content/index.tsx');
const content = readFileSync(SRC, 'utf8');

/** Вырезает тело конкретной мутации (от `const <name> = useMutation` до закрытия `});`). */
function mutationBody(name: string): string {
  const startMark = `const ${name} = useMutation({`;
  const start = content.indexOf(startMark);
  expect(start, `не найден ${name}`).toBeGreaterThanOrEqual(0);

  // Ищем вхождение «onSuccess» после старта и берём до конца onSuccess-колбэка.
  // Проще: берём от старта до следующего 'const ... = useMutation' или до конца.
  const next = content.indexOf(' = useMutation({', start + startMark.length);
  const end = next >= 0 ? next : content.length;
  return content.slice(start, end);
}

const SCOPED_INVALIDATION = 'queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] })';

describe('task #81: publish/edit/delete onSuccess инвалидируют scoped список', () => {
  it('publishContentMutation.onSuccess вызывает scoped invalidateQueries', () => {
    expect(mutationBody('publishContentMutation')).toContain(SCOPED_INVALIDATION);
  });

  it('updateContentMutation.onSuccess вызывает scoped invalidateQueries', () => {
    expect(mutationBody('updateContentMutation')).toContain(SCOPED_INVALIDATION);
  });

  it('deleteContentMutation.onSuccess вызывает scoped invalidateQueries', () => {
    expect(mutationBody('deleteContentMutation')).toContain(SCOPED_INVALIDATION);
  });
});
