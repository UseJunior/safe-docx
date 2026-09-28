/** Lowercase (optionally) and split text into its set of whitespace-delimited words. */
export function normalizedWordSet(text: string, caseInsensitive: boolean): Set<string> {
  const normalized = caseInsensitive ? text.toLowerCase() : text;
  return new Set(normalized.split(/\s+/u).filter(Boolean));
}

/** Count whitespace-delimited words without relying on a platform diff library. */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/** Return word-set intersection divided by union, from zero to one. */
export function jaccardWordSimilarity(
  text1: string,
  text2: string,
  caseInsensitive = true,
): number {
  return jaccardWordSetSimilarity(
    normalizedWordSet(text1, caseInsensitive),
    normalizedWordSet(text2, caseInsensitive),
  );
}

/** {@link jaccardWordSimilarity} over word sets that are already normalized. */
export function jaccardWordSetSimilarity(words1: ReadonlySet<string>, words2: ReadonlySet<string>): number {
  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;
  let intersectionSize = 0;
  for (const word of words1) if (words2.has(word)) intersectionSize++;
  return intersectionSize / (words1.size + words2.size - intersectionSize);
}

/** Return the fraction of the smaller word set contained in the larger set. */
export function wordContainmentSimilarity(
  text1: string,
  text2: string,
  caseInsensitive = true,
): number {
  return wordSetContainmentSimilarity(
    normalizedWordSet(text1, caseInsensitive),
    normalizedWordSet(text2, caseInsensitive),
  );
}

/** {@link wordContainmentSimilarity} over word sets that are already normalized. */
export function wordSetContainmentSimilarity(words1: ReadonlySet<string>, words2: ReadonlySet<string>): number {
  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;
  let intersectionSize = 0;
  for (const word of words1) if (words2.has(word)) intersectionSize++;
  return intersectionSize / Math.min(words1.size, words2.size);
}
