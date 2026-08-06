import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  isRenderableColorValue,
} from '../chart-styles';

describe('SM-21: chart tooltip stays opaque', () => {
  it('wraps every design token in hsl()', () => {
    const values = [
      ...Object.values(CHART_TOOLTIP_CONTENT_STYLE),
      ...Object.values(CHART_TOOLTIP_LABEL_STYLE),
      ...Object.values(CHART_TOOLTIP_ITEM_STYLE),
    ].filter((value): value is string => typeof value === 'string');

    for (const value of values) {
      // A bare var(--background) is an invalid colour: the browser drops the
      // declaration and the tooltip turns transparent, so bars show through.
      expect(isRenderableColorValue(value), value).toBe(true);
    }
  });

  it('gives the tooltip a real background rather than a token triplet', () => {
    expect(CHART_TOOLTIP_CONTENT_STYLE.backgroundColor).toBe('hsl(var(--background))');
    expect(CHART_TOOLTIP_CONTENT_STYLE.backgroundColor).not.toBe('var(--background)');
  });

  it('rejects the exact values that caused SM-21', () => {
    expect(isRenderableColorValue('var(--background)')).toBe(false);
    expect(isRenderableColorValue('1px solid var(--border)')).toBe(false);
    expect(isRenderableColorValue('var(--foreground)')).toBe(false);
  });

  it('accepts wrapped tokens and plain colours', () => {
    expect(isRenderableColorValue('hsl(var(--background))')).toBe(true);
    expect(isRenderableColorValue('1px solid hsl(var(--border))')).toBe(true);
    expect(isRenderableColorValue('hsl(var(--foreground) / 0.15)')).toBe(true);
    expect(isRenderableColorValue('#ffffff')).toBe(true);
  });

  it('leaves no bare token colour anywhere in client source', () => {
    // Guards the whole class of bug, not just the dashboard instance.
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSyncSafe(dir)) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = readFileSync(full, 'utf-8');
        for (const match of source.matchAll(/(background(?:Color)?|borderColor|color|border|fill|stroke)\s*:\s*'([^']*var\(--[^']*)'/g)) {
          // Radix exposes layout variables (sizes), only colours matter here.
          if (/radix|sidebar-width/.test(match[2])) continue;
          if (!isRenderableColorValue(match[2])) {
            offenders.push(`${full.replace(root, '')}: ${match[0]}`);
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});

function readdirSyncSafe(dir: string) {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
