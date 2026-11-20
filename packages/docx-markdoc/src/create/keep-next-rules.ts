import { CREATION_STYLE } from './profile.js';

/**
 * Where create sets `w:keepNext` by its own rule rather than the source's
 * `keep-with-next` flag. The lowering (`lower.ts`, `theme.ts`) applies these
 * rules and the round-trip source oracle (`oracle.ts`) marks the same
 * paragraphs from them, so the two cannot drift apart.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1522
 */

/** The block kinds the keep-with-next rules look at; any other block is `other`. */
export type KeepNextBlockKind = 'legend' | 'signer' | 'other';

/**
 * Whether create keeps the last paragraph before a block of `kind` with it:
 * before a legend, and before a first signer (one not following another
 * signer). `previousKind` is the kind of the block before it.
 */
export function keepsPreviousWithNext(kind: KeepNextBlockKind, previousKind: KeepNextBlockKind | undefined): boolean {
  if (kind === 'legend') return true;
  return kind === 'signer' && previousKind !== 'signer';
}

/** Whether create keeps a run-in paragraph at `level` with the next paragraph: an article does. */
export function runInKeepsWithNext(level: string): boolean {
  return level === 'article';
}

/**
 * Whether a pulled body paragraph followed by a paragraph of style `nextStyle`
 * already carries create's automatic `w:keepNext`: a legend or signature
 * paragraph follows it. Pull uses this so it does not restate the rule as an
 * explicit keep-with-next tag.
 */
export function keptWithNextBeforeStyle(nextStyle: string | undefined): boolean {
  return nextStyle === CREATION_STYLE.legend || nextStyle === CREATION_STYLE.signature;
}
