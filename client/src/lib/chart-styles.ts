/**
 * Shared styles for recharts overlays.
 *
 * The design tokens in index.css hold bare HSL triplets ("0 0% 100%"), not
 * finished colours. Inline styles must therefore wrap them in hsl(), the same
 * way the chart series do with hsl(var(--primary)). Passing var(--background)
 * straight to backgroundColor yields an invalid declaration, the browser drops
 * it, and the tooltip renders fully transparent - which is how SM-21 showed up:
 * the bars appeared to run straight through the tooltip text.
 */

export const CHART_TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  // Without an explicit shadow the tooltip reads as part of the plot area on
  // light themes, where background and card share the same colour.
  boxShadow: '0 4px 12px hsl(var(--foreground) / 0.15)',
} as const;

export const CHART_TOOLTIP_LABEL_STYLE = {
  color: 'hsl(var(--foreground))',
  fontWeight: 600,
} as const;

export const CHART_TOOLTIP_ITEM_STYLE = {
  color: 'hsl(var(--foreground))',
} as const;

/**
 * A colour that the browser will actually apply. Tokens are triplets, so any
 * value that mentions var(--...) outside of hsl() is a dropped declaration.
 */
export function isRenderableColorValue(value: string): boolean {
  if (!value.includes('var(--')) return true;
  return /hsl\(\s*var\(--[^)]+\)/.test(value);
}
