import { createHash } from 'node:crypto';

/**
 * Compute a portable content fingerprint for a paragraph's raw visible text.
 *
 * Algorithm: `sha256:nfkc:` + first 32 hex chars of `sha256( NFKC(text).replace(/\s+/g, " ").trim() )`.
 *
 * Order matters: NFKC must run before whitespace collapse so that compatibility
 * whitespace (NBSP, ideographic space) is normalized to ASCII space first and
 * then folded by `\s+`. Case is preserved — citation systems need to distinguish
 * "Section 5" from "section 5".
 *
 * The output is read-only metadata, not an edit anchor. Edit tools accept only
 * `_bk_*` paragraph IDs.
 *
 * The 128-bit truncation (32 hex) is collision-safe at any realistic citation-corpus
 * scale; the `sha256:nfkc:` prefix reserves space for future algorithm bumps.
 */
export function computeContentFingerprint(rawVisibleText: string): string {
  const normalized = rawVisibleText.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const hex = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `sha256:nfkc:${hex}`;
}
