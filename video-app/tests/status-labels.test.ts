import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel, statusColor, STATUS_LABELS, STATUS_COLORS, UNKNOWN_STATUS_COLOR } from '../client/src/lib/status-labels.ts';

/** Статусы, которые сервер действительно выставляет проекту. */
const SERVER_STATUSES = [
  'idle',
  'generating_script',
  'searching_stock',
  'script_ready',
  'generating_images',
  'animating',
  'assembling',
  'done',
  'error',
];

describe('status-labels', () => {
  it('у каждого статуса сервера есть человеческая подпись', () => {
    for (const s of SERVER_STATUSES) {
      assert.ok(STATUS_LABELS[s], `нет подписи для статуса ${s}`);
      assert.notEqual(statusLabel(s), s, `подпись для ${s} совпадает со служебным именем`);
    }
  });

  it('у каждого статуса сервера есть цвет', () => {
    for (const s of SERVER_STATUSES) {
      assert.ok(STATUS_COLORS[s], `нет цвета для статуса ${s}`);
    }
  });

  it('цвета шестнадцатеричные: галерея приписывает к ним альфу', () => {
    for (const [name, color] of Object.entries(STATUS_COLORS)) {
      assert.match(color, /^#[0-9a-f]{6}$/i, `цвет статуса ${name} нельзя дополнить альфой: ${color}`);
    }
  });

  it('незнакомый статус: подпись — сам статус, цвет — серый, а не undefined', () => {
    assert.equal(statusLabel('teleporting'), 'teleporting');
    assert.equal(statusColor('teleporting'), UNKNOWN_STATUS_COLOR);
    assert.ok(!String(statusColor('teleporting')).includes('undefined'));
  });
});
