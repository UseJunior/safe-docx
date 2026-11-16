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

/** Lowercase (optionally) and split text into its whitespace-delimited word sequence. */
export function normalizedWordSequence(text: string, caseInsensitive: boolean): string[] {
  const normalized = caseInsensitive ? text.toLowerCase() : text;
  return normalized.split(/\s+/u).filter(Boolean);
}

/**
 * Return the in-order similarity of two word sequences, from zero to one:
 * twice their longest common subsequence divided by their total length.
 *
 * Unlike word-set measures, this compares the spans themselves: a short
 * phrase whose words all occur somewhere in a long paragraph scores low, and
 * two clauses built from the same vocabulary in a different order score low.
 * A pair that provably scores below `floor` returns 0 without the full
 * comparison.
 */
export function wordSequenceSimilarity(
  words1: readonly string[],
  words2: readonly string[],
  floor = 0,
): number {
  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;
  // The common subsequence cannot exceed the shared multiset of words, so a
  // pair whose bound already misses the floor skips the quadratic table.
  const counts = new Map<string, number>();
  for (const word of words1) counts.set(word, (counts.get(word) ?? 0) + 1);
  let sharedWords = 0;
  for (const word of words2) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      sharedWords++;
      counts.set(word, count - 1);
    }
  }
  if ((2 * sharedWords) / (words1.length + words2.length) < floor) return 0;
  const [outer, inner] = words1.length >= words2.length ? [words1, words2] : [words2, words1];
  let previous = new Uint32Array(inner.length + 1);
  let current = new Uint32Array(inner.length + 1);
  for (let i = 1; i <= outer.length; i++) {
    const word = outer[i - 1];
    for (let j = 1; j <= inner.length; j++) {
      current[j] = word === inner[j - 1]
        ? previous[j - 1]! + 1
        : Math.max(previous[j]!, current[j - 1]!);
    }
    [previous, current] = [current, previous];
  }
  return (2 * previous[inner.length]!) / (words1.length + words2.length);
}
