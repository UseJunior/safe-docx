/**
 * Versioned, bounded aliases for Microsoft Word's built-in Heading 1..9
 * paragraph styles. These are exact aliases after Unicode and whitespace
 * normalization; this module deliberately performs no fuzzy matching.
 */

export type BuiltInHeadingAlias = {
  locale: 'en' | 'fr' | 'de' | 'es' | 'ja';
  name: string;
  level: number;
};

const LOCALIZED_STEMS: ReadonlyArray<{
  locale: BuiltInHeadingAlias['locale'];
  stem: string;
}> = [
  { locale: 'en', stem: 'Heading' },
  { locale: 'fr', stem: 'Titre' },
  { locale: 'de', stem: 'Überschrift' },
  { locale: 'es', stem: 'Título' },
  { locale: 'ja', stem: '見出し' },
];

export const BUILT_IN_HEADING_ALIASES_V1: readonly BuiltInHeadingAlias[] =
  LOCALIZED_STEMS.flatMap(({ locale, stem }) =>
    Array.from({ length: 9 }, (_, index) => ({
      locale,
      name: `${stem} ${index + 1}`,
      level: index + 1,
    })),
  );

export function normalizeBuiltInStyleName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

const LEVEL_BY_NORMALIZED_ALIAS = new Map(
  BUILT_IN_HEADING_ALIASES_V1.map(({ name, level }) => [
    normalizeBuiltInStyleName(name),
    level,
  ]),
);

export function getBuiltInHeadingLevel(
  styleId: string | null,
  styleName: string | null,
): number | null {
  const idMatch = styleId ? /^Heading([1-9])$/.exec(styleId) : null;
  if (idMatch) return Number(idMatch[1]);
  if (!styleName) return null;
  return LEVEL_BY_NORMALIZED_ALIAS.get(normalizeBuiltInStyleName(styleName)) ?? null;
}
