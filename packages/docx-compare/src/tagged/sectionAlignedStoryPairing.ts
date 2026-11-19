/**
 * Header/footer story identity through section alignment.
 *
 * A header or footer a reader sees is an effective slot: section × kind
 * (header, footer) × role (default, first, even) after inheritance, with
 * `w:titlePg` and `w:evenAndOddHeaders` deciding which role each page uses
 * (`effectiveStoryBindings.ts`). Physical part names, explicit-versus-inherited
 * references and the number of sections are allocation details.
 *
 * The outer (body) comparison has already aligned the two documents'
 * sections: Reject All of its output has the original's sections in order,
 * and Accept All has the revised document's. So the slot at section `i` of the
 * rejected output stands for the original's section `i`, and likewise on the
 * accept side, whatever sections were added, removed or re-laid-out. A part
 * `B` of the compared package (the revised side's part) is paired with the
 * original story `A` when every slot and page of the rejected output that
 * shows `B` shows `A` in the original. Splicing the redline `A → B` into `B`
 * then makes Reject All show `A` and Accept All show `B` wherever `B` is
 * shown.
 *
 * A pair is kept only when the pages it touches come out right in both
 * projections: every page of the original that shows a paired story must be
 * reproduced by Reject All, and every page Accept All shows from a paired part
 * must be what the revised document shows there. Where a page cannot come out
 * right (the settings part, which carries `w:evenAndOddHeaders`, has no
 * revision markup and keeps the revised value, so for example turning
 * different even pages off leaves Reject All showing the default story on the
 * original's even pages), the stories involved are not paired and stay in
 * `unrepresentedChanges`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1390
 */

import {
  effectiveStorySlot,
  pageStorySlots,
  STORY_KINDS,
  STORY_ROLES,
  type EffectiveStoryBindings,
  type StoryKind,
} from './effectiveStoryBindings.js';

/** Identity of a blank or absent story. */
export const BLANK_STORY_IDENTITY = '∅';

/** One slot or page of one section, as two projections of it bind it. */
export interface AlignedStoryKey {
  sectionOrdinal: number;
  kind: StoryKind;
  /** Part bound by the compared package's projection (Accept All or Reject All). */
  compared: string | undefined;
  /** Part bound by the matching input (original or revised). */
  input: string | undefined;
}

/**
 * Keys comparing one projection of the compared package with the input it
 * must reproduce, section by section. Each kind contributes its role slots
 * and its first, odd and even pages. A role slot counts only when both sides
 * agree on whether it is displayed: when a display switch differs, the pages
 * say which story each side shows instead. Returns `undefined` when the
 * section counts differ, so the projections cannot be aligned.
 */
export function alignedStoryKeys(
  compared: EffectiveStoryBindings,
  input: EffectiveStoryBindings,
): AlignedStoryKey[] | undefined {
  if (compared.sectionCount !== input.sectionCount) return undefined;
  const keys: AlignedStoryKey[] = [];
  for (let sectionOrdinal = 0; sectionOrdinal < compared.sectionCount; sectionOrdinal += 1) {
    for (const kind of STORY_KINDS) {
      for (const role of STORY_ROLES) {
        const left = effectiveStorySlot(compared, { sectionOrdinal, kind, role })!;
        const right = effectiveStorySlot(input, { sectionOrdinal, kind, role })!;
        if (left.displayed !== right.displayed) continue;
        keys.push({ sectionOrdinal, kind, compared: left.targetPath, input: right.targetPath });
      }
    }
  }
  const comparedPages = pageStorySlots(compared);
  const inputPages = pageStorySlots(input);
  for (let index = 0; index < comparedPages.length; index += 1) {
    const left = comparedPages[index]!;
    const right = inputPages[index]!;
    keys.push({
      sectionOrdinal: left.slot.sectionOrdinal,
      kind: left.slot.kind,
      compared: left.slot.targetPath,
      input: right.slot.targetPath,
    });
  }
  return keys;
}

export interface SectionAlignedPairingInput {
  /** Reject All of the compared package, against the original (itself after Reject All). */
  rejected: EffectiveStoryBindings;
  original: EffectiveStoryBindings;
  /** Accept All of the compared package, against the revised document (itself after Accept All). */
  accepted: EffectiveStoryBindings;
  revised: EffectiveStoryBindings;
  /** Content identity of an original part; `BLANK_STORY_IDENTITY` for none or a blank one. */
  originalIdentity: (path: string | undefined) => string;
  /** Content identity of a revised part, on the same scale. */
  revisedIdentity: (path: string | undefined) => string;
  /** Content identity of a compared-package part before any story is spliced in. */
  comparedIdentity: (path: string | undefined) => string;
  /** Whether compared part `comparedPath` may receive the redline of original part `originalPath`. */
  eligible: (comparedPath: string, originalPath: string) => boolean;
}

export interface SectionAlignedPairing {
  /** Compared part path → the original part whose redline it receives. */
  pairs: Map<string, string>;
  /**
   * Sections (by ordinal) and kinds whose every slot and page now comes out
   * right in both projections, with at least one paired story among them.
   * Positional header/footer reports for them are represented.
   */
  representedSectionKinds: Array<{ sectionIndex: number; kind: StoryKind }>;
}

/**
 * Pair compared-package parts with original stories through the section
 * alignment the outer comparison emitted, then drop pairs whose pages would
 * not come out right.
 */
export function pairStoriesThroughSectionAlignment(
  input: SectionAlignedPairingInput,
): SectionAlignedPairing {
  const rejectKeys = alignedStoryKeys(input.rejected, input.original);
  const acceptKeys = alignedStoryKeys(input.accepted, input.revised);
  const pairs = new Map<string, string>();
  if (!rejectKeys || !acceptKeys) return { pairs, representedSectionKinds: [] };

  const shownOriginals = new Map<string, Map<string, string | undefined>>();
  for (const key of rejectKeys) {
    if (key.compared === undefined) continue;
    const identities = shownOriginals.get(key.compared) ?? new Map<string, string | undefined>();
    const identity = input.originalIdentity(key.input);
    if (!identities.has(identity)) identities.set(identity, key.input);
    shownOriginals.set(key.compared, identities);
  }
  for (const [comparedPath, identities] of [...shownOriginals].sort(([left], [right]) => left.localeCompare(right))) {
    if (identities.size !== 1) continue;
    const [identity, originalPath] = [...identities][0]!;
    if (identity === BLANK_STORY_IDENTITY || originalPath === undefined) continue;
    if (input.eligible(comparedPath, originalPath)) pairs.set(comparedPath, originalPath);
  }

  const predictedRejection = (path: string | undefined): string =>
    path !== undefined && pairs.has(path)
      ? input.originalIdentity(pairs.get(path))
      : input.comparedIdentity(path);
  const pairedIdentities = (): Set<string> =>
    new Set([...pairs.values()].map((path) => input.originalIdentity(path)));
  const rejectHolds = (key: AlignedStoryKey): boolean =>
    predictedRejection(key.compared) === input.originalIdentity(key.input);
  const acceptHolds = (key: AlignedStoryKey): boolean =>
    input.comparedIdentity(key.compared) === input.revisedIdentity(key.input);

  for (let changed = true; changed;) {
    changed = false;
    const identities = pairedIdentities();
    const drop = new Set<string>();
    for (const key of rejectKeys) {
      const originalIdentity = input.originalIdentity(key.input);
      const involved = (key.compared !== undefined && pairs.has(key.compared)) || identities.has(originalIdentity);
      if (!involved || rejectHolds(key)) continue;
      if (key.compared !== undefined && pairs.has(key.compared)) drop.add(key.compared);
      for (const [comparedPath, originalPath] of pairs) {
        if (input.originalIdentity(originalPath) === originalIdentity) drop.add(comparedPath);
      }
    }
    for (const key of acceptKeys) {
      const touched = [key.compared, key.input].filter(
        (path): path is string => path !== undefined && pairs.has(path),
      );
      if (touched.length === 0 || acceptHolds(key)) continue;
      for (const path of touched) drop.add(path);
    }
    for (const path of drop) {
      pairs.delete(path);
      changed = true;
    }
  }

  const representedSectionKinds: Array<{ sectionIndex: number; kind: StoryKind }> = [];
  const sectionCount = Math.max(input.original.sectionCount, input.revised.sectionCount);
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    for (const kind of STORY_KINDS) {
      const rejectAt = rejectKeys.filter((key) => key.sectionOrdinal === sectionIndex && key.kind === kind);
      const acceptAt = acceptKeys.filter((key) => key.sectionOrdinal === sectionIndex && key.kind === kind);
      const involved = [...rejectAt, ...acceptAt].some(
        (key) => key.compared !== undefined && pairs.has(key.compared),
      );
      if (involved && rejectAt.every(rejectHolds) && acceptAt.every(acceptHolds)) {
        representedSectionKinds.push({ sectionIndex, kind });
      }
    }
  }
  return { pairs, representedSectionKinds };
}
