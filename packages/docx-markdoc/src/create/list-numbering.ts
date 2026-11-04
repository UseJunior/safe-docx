import type { NumberingLevelSpec, NumberingSpec } from '@usejunior/docx-core';
import { CREATION_STYLE } from './profile.js';

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
 * - `heading-level`: an ordered list under a numbered heading (frontmatter
 *   `heading-numbers: legal`). Its items are levels 2 to 4 of the heading
 *   definition, `(a)`, `(i)`, `(A)`, so Word restarts them under each
 *   Article or Section and a cross-reference reads "Section 1.01(a)". The
 *   list uses the definition's own instance; validation has already required
 *   its first marker to be 1 or to continue the previous list under the
 *   same heading.
 * - `bullet`: a bullet list, which shows no number and keeps its own
 *   definition.
 */
export type ListNumberingDecision =
  | { kind: 'begins'; numId: string; start: number }
  | { kind: 'continues'; numId: string; start: number }
  | { kind: 'restarts'; numId: string; start: number }
  | { kind: 'heading-level'; numId: string; ilvl: number; start: number }
  | { kind: 'bullet'; numId: string };

/** Frontmatter `heading-numbers` values: how `##` and `###` headings are numbered. */
export const HEADING_NUMBER_SCHEMES = ['legal'] as const;
export type HeadingNumberScheme = (typeof HEADING_NUMBER_SCHEMES)[number];

/** First clause level of the heading definition: `(a)` sits below `Section %1.%2`. */
export const HEADING_CLAUSE_ILVL = 2;

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
 * The `legal` heading definition: `##` is "ARTICLE I" (upper Roman), `###`
 * is "Section 1.01" (legal numbering, so the Article shows as 1, and the
 * Section zero-padded), and ordered lists under them are `(a)`, `(i)`,
 * `(A)`. The heading levels link to the Heading 1 and Heading 2 styles
 * (`w:pStyle`), as Word's own outline numbering does: a heading is numbered
 * by its style, and a paragraph a Word user sets to Heading 2 becomes the
 * next Section. No level text ends with a period, so Word and LibreOffice
 * show the same full-context cross-reference ("Section 2.06(b)"; evidence:
 * scripts/oracle/word/evidence/issue-1236-word-16.114.json and
 * issue-1250-word-16.114.json).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.10
 * @see https://github.com/UseJunior/safe-docx/issues/1250
 */
function legalHeadingLevels(): NumberingLevelSpec[] {
  const heading = (ilvl: number, numFmt: 'upperRoman' | 'decimalZero', lvlText: string, pStyle: string): NumberingLevelSpec => ({
    ilvl,
    numFmt,
    lvlText,
    pStyle,
    ...(ilvl === 1 ? { isLgl: true } : {}),
    suff: 'space',
    indentTwips: { left: 0, firstLine: 0 },
  });
  const clauses = ([['lowerLetter', '(%3)'], ['lowerRoman', '(%4)'], ['upperLetter', '(%5)']] as const).map(([numFmt, lvlText], depth): NumberingLevelSpec => ({
    ilvl: HEADING_CLAUSE_ILVL + depth,
    numFmt,
    lvlText,
    suff: 'tab',
    indentTwips: { left: 720 * (depth + 1), hanging: 720 },
  }));
  return [
    heading(0, 'upperRoman', 'ARTICLE %1', CREATION_STYLE.heading1),
    heading(1, 'decimalZero', 'Section %1.%2', CREATION_STYLE.heading2),
    ...clauses,
  ];
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
  /** The heading definition, once the first numbered heading is placed. */
  private heading: NumberingSpec | null = null;
  /** The number the next clause under the current numbered heading would show, or null before the first heading. */
  private clauseNext: number | null = null;

  /** @param headingNumbers the frontmatter `heading-numbers` scheme, or undefined when headings are not numbered. */
  constructor(private readonly headingNumbers?: HeadingNumberScheme) {}

  /** The heading definition's handle, or undefined while no heading is numbered. */
  get headingNumId(): string | undefined {
    return this.heading?.numId;
  }

  /**
   * Place a `##` or `###` heading. With heading numbering on, the heading is
   * numbered by its style's link to the heading definition, which is
   * declared at the first heading, and the clauses under it start again at
   * `(a)` (the clause levels restart after any higher level). Without
   * heading numbering this does nothing.
   */
  placeHeading(): void {
    if (!this.headingNumbers) return;
    if (!this.heading) {
      this.heading = { numId: `headings-${this.definitions.length + 1}`, levels: legalHeadingLevels() };
      this.definitions.push(this.heading);
    }
    this.clauseNext = 1;
  }

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
    if (this.heading && this.clauseNext !== null) {
      // Validation guarantees the marker; a mismatch here would show numbers the source did not write.
      if (start !== this.clauseNext) throw new Error(`a list under a numbered heading starts at ${start}, not ${this.clauseNext}`);
      this.clauseNext = start + items;
      return { kind: 'heading-level', numId: this.heading.numId, ilvl: HEADING_CLAUSE_ILVL, start };
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
