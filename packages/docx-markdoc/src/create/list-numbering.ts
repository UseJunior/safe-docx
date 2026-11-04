import type { NumberingLevelSpec, NumberingSpec } from '@usejunior/docx-core';

/**
 * How a top-level list's numbering relates to the ordered lists before it.
 *
 * - `begins`: the document's first ordered list. It takes the shared ordered
 *   definition's own instance, whose level 0 starts at the list's first marker.
 * - `continues`: the first marker is the previous ordered list's last number
 *   plus one. The list reuses the previous list's `w:numId`, so Word counts
 *   both as one list and renumbers the later one when a clause is inserted
 *   in the earlier one.
 * - `restarts`: any other first marker. The list takes a new `w:num` over the
 *   same abstract definition with a level-0 `w:startOverride` at its marker,
 *   which is how Word itself restarts a list.
 * - `bullet`: a bullet list, which shows no number and keeps its own
 *   definition.
 */
export type ListNumberingDecision =
  | { kind: 'begins'; numId: string; start: number }
  | { kind: 'continues'; numId: string; start: number }
  | { kind: 'restarts'; numId: string; start: number }
  | { kind: 'bullet'; numId: string };

const ORDERED_FORMATS = [['decimal', '%1.'], ['lowerLetter', '(%2)'], ['lowerRoman', '(%3)']] as const;
const BULLET_FORMATS = [['bullet', '•'], ['bullet', '◦'], ['bullet', '▪']] as const;

function listLevels(ordered: boolean, start: number): NumberingLevelSpec[] {
  return (ordered ? ORDERED_FORMATS : BULLET_FORMATS).map(([numFmt, lvlText], ilvl) => ({
    ilvl,
    start: ilvl === 0 ? start : 1,
    numFmt,
    lvlText,
    suff: 'tab' as const,
    indentTwips: { left: 720 * (ilvl + 1), hanging: ordered ? 720 : 360 },
  }));
}

/**
 * The one place `create` decides which Word list each top-level Markdoc list
 * belongs to. Every ordered list shares one abstract definition (legal
 * `1.`/`(a)`/`(i)`), so Word keeps a single running count across headings;
 * a list continues or restarts that count by its first marker, as
 * {@link ListNumberingDecision} describes. Nested lists number as deeper
 * levels of their top-level list and restart under each new item.
 *
 * The numbers Word shows therefore equal the Markdoc markers: a continuing
 * list's first number is its marker by construction, and a restarting list's
 * override is its marker. The source projection keeps numbering each list
 * from its own first marker, and the read-back checks hold the two to the
 * same numbers.
 *
 * Every instance of one abstract definition shares one running sequence in
 * Word and LibreOffice, and a `w:startOverride` restarts it at the first
 * paragraph of its instance (oracle evidence:
 * scripts/oracle/word/evidence/issue-1243-word-16.114.json).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.26
 * @see https://github.com/UseJunior/safe-docx/issues/1252
 */
export class CreationListNumbering {
  /** Numbering definitions in declaration order, for `DocumentSpec.numbering`. */
  readonly definitions: NumberingSpec[] = [];
  /** The shared ordered definition, the instance the last ordered list used, and the number its next item would show. */
  private ordered: { definition: NumberingSpec; numId: string; next: number } | null = null;

  /**
   * Place one top-level list. `start` is its first marker (1 for a bullet
   * list) and `items` its number of top-level items.
   */
  placeTopLevelList(ordered: boolean, start: number, items: number): ListNumberingDecision {
    if (!ordered) {
      const numId = `ul-${this.definitions.length + 1}`;
      this.definitions.push({ numId, levels: listLevels(false, 1) });
      return { kind: 'bullet', numId };
    }
    const decision = this.decideOrdered(start);
    this.ordered!.numId = decision.numId;
    this.ordered!.next = start + items;
    return decision;
  }

  private decideOrdered(start: number): ListNumberingDecision {
    if (!this.ordered) {
      const definition: NumberingSpec = { numId: `ol-${this.definitions.length + 1}`, levels: listLevels(true, start) };
      this.definitions.push(definition);
      this.ordered = { definition, numId: definition.numId, next: start };
      return { kind: 'begins', numId: definition.numId, start };
    }
    if (start === this.ordered.next) return { kind: 'continues', numId: this.ordered.numId, start };
    const { definition } = this.ordered;
    const instances = (definition.instances ??= []);
    const numId = `${definition.numId}-restart-${instances.length + 1}`;
    instances.push({ numId, levelOverrides: [{ ilvl: 0, startOverride: start }] });
    return { kind: 'restarts', numId, start };
  }
}
