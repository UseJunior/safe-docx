import { createHash } from 'node:crypto';

/**
 * Cf-category and bidi/joiner invisibles that change a paragraph's bytes
 * without changing its rendered surface in any reader Word/Pages/Google Docs
 * actually ships. Stripping them before hashing means a paragraph that picked
 * up a stray soft hyphen (cooperate vs co­operate) or a ZWJ (AB vs A‍B)
 * during round-tripping still fingerprints to the same value as the clean copy.
 *
 * Range covered (each value is a single Unicode code point):
 *   U+00AD                SOFT HYPHEN
 *   U+200B                ZERO WIDTH SPACE
 *   U+200C                ZERO WIDTH NON-JOINER
 *   U+200D                ZERO WIDTH JOINER
 *   U+200E                LEFT-TO-RIGHT MARK
 *   U+200F                RIGHT-TO-LEFT MARK
 *   U+202A..U+202E        bidi embedding/override controls (LRE, RLE, PDF, LRO, RLO)
 *   U+FE00..U+FE0F        variation selectors VS1..VS16
 *   U+FEFF                ZERO WIDTH NO-BREAK SPACE / BYTE ORDER MARK
 *
 * NOT stripped on purpose:
 *   - curly quotes (U+2018/U+2019/U+201C/U+201D), en/em dashes (U+2013/U+2014),
 *     ellipsis (U+2026), etc. Citation systems legitimately distinguish these
 *     from ASCII variants. NFKC already handles compatibility decompositions
 *     (ligatures, full-width Latin, NBSP) — that is its job, not ours.
 */
const INVISIBLE_FORMAT_CHARS_RE = /[­​-‏‪-‮︀-️﻿]/g;

/**
 * Compute a portable content fingerprint for a paragraph's raw visible text.
 *
 * Algorithm: `sha256:nfkc:` + first 32 hex chars of
 *   `sha256( stripInvisibles(NFKC(text)).replace(/\s+/g, " ").trim() )`.
 *
 * Order matters:
 *   1. NFKC first so compatibility whitespace (NBSP, ideographic space) is
 *      normalized to ASCII space and ligatures/full-width Latin decompose.
 *   2. Strip Cf-category invisibles (soft hyphen, ZWJ, ZWNJ, LRM/RLM, bidi
 *      controls, variation selectors, BOM) so byte-level round-trip noise
 *      doesn't change the hash without changing the visible glyphs.
 *   3. Whitespace collapse + trim.
 *
 * Case is preserved — citation systems need to distinguish "Section 5" from
 * "section 5". Curly quotes / en-dashes / ellipses are NOT folded to ASCII;
 * legal practice distinguishes them.
 *
 * The output is read-only metadata, not an edit anchor. Edit tools accept only
 * `_bk_*` paragraph IDs.
 *
 * The 128-bit truncation (32 hex) is collision-safe at any realistic
 * citation-corpus scale; the `sha256:nfkc:` prefix reserves space for future
 * algorithm bumps (e.g. `sha256:nfkc-strip:`). Consumers SHOULD store and
 * compare the full prefixed string so an algorithm bump cleanly invalidates
 * old hashes.
 */
export function computeContentFingerprint(rawVisibleText: string): string {
  const normalized = rawVisibleText
    .normalize('NFKC')
    .replace(INVISIBLE_FORMAT_CHARS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hex = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `sha256:nfkc:${hex}`;
}
