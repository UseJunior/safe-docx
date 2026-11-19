/**
 * Bookmark names for generated cross-reference targets.
 *
 * Word's Insert → Bookmark dialog accepts a name of at most 40 characters
 * that starts with a letter and holds only letters, digits and underscores; a
 * name starting with an underscore is a hidden bookmark (Word's own `_Ref…`
 * and `_Toc…` names). Generated documents keep to those rules so a reader can
 * see, follow and edit every target in Word's dialog. ECMA-376 itself only
 * types the name as a string (§ 17.13.6.2).
 *
 * Authors name targets with readable kebab-case ids
 * (`purchase-price-adjustment`). {@link bookmarkNameForSlug} maps an id to a
 * bookmark name deterministically, and {@link bookmarkNamesForSlugs} maps a
 * whole document's ids and fails when two of them would share a name.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/1236
 */

import { createHash } from 'node:crypto';

/** The longest bookmark name Word's Bookmark dialog accepts. */
export const BOOKMARK_NAME_MAX_LENGTH = 40;

const BOOKMARK_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const SLUG_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const HASH_LENGTH = 8;

/** A name Word's Bookmark dialog accepts and does not hide. */
export function isWordBookmarkName(name: string): boolean {
  return name.length <= BOOKMARK_NAME_MAX_LENGTH && BOOKMARK_NAME_RE.test(name);
}

export type BookmarkNameErrorCode = 'invalid_slug' | 'name_collision';

/** A slug that cannot be mapped, or two slugs that map to one bookmark name. */
export class BookmarkNameError extends Error {
  readonly code: BookmarkNameErrorCode;
  /** The offending slug, or both colliding slugs in input order. */
  readonly slugs: readonly string[];

  constructor(code: BookmarkNameErrorCode, slugs: readonly string[], message: string) {
    super(message);
    this.name = 'BookmarkNameError';
    this.code = code;
    this.slugs = slugs;
  }
}

/**
 * Map an id to a bookmark name: hyphens become underscores, and an id longer
 * than 40 characters keeps its first 31 characters (trailing underscores
 * dropped) followed by an underscore and the first eight hex digits of the
 * id's SHA-256. The id must start with a letter and hold only letters,
 * digits, hyphens and underscores, so the name never starts with an
 * underscore (a hidden bookmark).
 *
 * `purchase-price-adjustment` → `purchase_price_adjustment`.
 */
export function bookmarkNameForSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new BookmarkNameError(
      'invalid_slug',
      [slug],
      `Id '${slug}' cannot name a bookmark: it must start with a letter and hold only letters, digits, hyphens and underscores`,
    );
  }
  const name = slug.replace(/-/g, '_');
  if (name.length <= BOOKMARK_NAME_MAX_LENGTH) return name;
  const hash = createHash('sha256').update(slug).digest('hex').slice(0, HASH_LENGTH);
  const head = name.slice(0, BOOKMARK_NAME_MAX_LENGTH - HASH_LENGTH - 1).replace(/_+$/, '');
  return `${head}_${hash}`;
}

/**
 * Map every id of one document to its bookmark name. Fails when two ids map
 * to the same name, compared without regard to case (`a-b` and `a_b`, or
 * two long ids whose truncations and hashes coincide), so a cross-reference
 * can never silently reach the wrong target.
 */
export function bookmarkNamesForSlugs(slugs: Iterable<string>): Map<string, string> {
  const names = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const slug of slugs) {
    if (names.has(slug)) continue;
    const name = bookmarkNameForSlug(slug);
    const key = name.toLowerCase();
    const owner = owners.get(key);
    if (owner !== undefined) {
      throw new BookmarkNameError(
        'name_collision',
        [owner, slug],
        `Ids '${owner}' and '${slug}' both map to bookmark name '${name}'; rename one of them`,
      );
    }
    owners.set(key, slug);
    names.set(slug, name);
  }
  return names;
}
