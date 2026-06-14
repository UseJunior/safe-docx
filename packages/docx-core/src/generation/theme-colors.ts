import type { DocumentThemeSpec, ThemeColorSlot } from './types.js';

export const CANONICAL_THEME_COLORS: Record<ThemeColorSlot, string> = {
  text1: '000000',
  background1: 'FFFFFF',
  text2: '44546A',
  background2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hyperlink: '0563C1',
  followedHyperlink: '954F72',
};

export function resolveThemeColorValues(theme?: DocumentThemeSpec): ReadonlyMap<ThemeColorSlot, string> {
  return new Map(Object.entries({ ...CANONICAL_THEME_COLORS, ...(theme?.colors ?? {}) }) as Array<[ThemeColorSlot, string]>);
}
