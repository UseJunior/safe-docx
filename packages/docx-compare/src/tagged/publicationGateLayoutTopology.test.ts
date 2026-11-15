/**
 * Fault injection against the tagged publication gate for the two kinds of
 * difference its text normalization used to erase: run-content layout
 * characters (#1026) and empty paragraphs (#1027).
 *
 * Each case runs a real comparison, then tampers with the emitted document
 * before the gate reads it, so the failure observed is the gate's own.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.29
 * @see https://github.com/UseJunior/safe-docx/issues/1026
 * @see https://github.com/UseJunior/safe-docx/issues/1027
 */

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  extractRoundTripComparisonText,
  extractRoundTripParagraphTopology,
  ROUND_TRIP_LAYOUT_CHARACTERS,
} from '../fieldComparisonSemantics.js';
import {
  compareDocumentsAtomizer,
  compareParagraphTopology,
  evaluateSafetyChecks,
  TaggedPublicationSafetyError,
} from './pipeline.js';
import {
  acceptAllChanges,
  compareTexts,
  normalizeLayoutPreservingText,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'add-publication-gate-layout-topology-checks';
const OPTIONS = { author: 'Gate Fault Injection', date: new Date('2026-11-15T00:00:00Z') };

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Publication Gate Layout And Topology',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.32' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.4' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.29' },
  );

const run = (inner: string): string => `<w:r>${inner}</w:r>`;
const para = (...runs: string[]): string => `<w:p>${runs.join('')}</w:p>`;
const text = (value: string): string => `<w:t xml:space="preserve">${value}</w:t>`;
const EMPTY_PARAGRAPH = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';

/** A paragraph whose word changes, so every comparison carries real revisions. */
const EDITED_ORIGINAL = para(run(text('Alpha clause')));
const EDITED_REVISED = para(run(text('Beta clause')));

interface GateOutcome {
  error?: TaggedPublicationSafetyError;
  tampered: boolean;
}

/**
 * Compare `body + edited paragraph` on both sides, rewrite the emitted
 * document with `tamper`, and let the real gate judge the rewritten output.
 */
async function gateOnTamperedOutput(
  originalBody: string,
  revisedBody: string,
  tamper: (xml: string) => string,
): Promise<GateOutcome> {
  const original = await buildDocxFromBodyXml(originalBody + EDITED_ORIGINAL);
  const revised = await buildDocxFromBodyXml(revisedBody + EDITED_REVISED);
  let tampered = false;
  try {
    await compareDocumentsAtomizer(original, revised, {
      ...OPTIONS,
      taggedTreePublicationSafetyEvaluator: (
        originalText, revisedText, originalBookmarks, revisedBookmarks,
        candidateXml, sidecars, topology,
      ) => {
        const rewritten = tamper(candidateXml);
        tampered = rewritten !== candidateXml;
        return evaluateSafetyChecks(
          originalText, revisedText, originalBookmarks, revisedBookmarks,
          rewritten, sidecars, topology,
        );
      },
    });
    return { tampered };
  } catch (error) {
    if (error instanceof TaggedPublicationSafetyError) return { error, tampered };
    throw error;
  }
}

const dropFirst = (needle: string) => (xml: string): string => xml.replace(needle, '');
const insertBeforeFirst = (anchor: string, inserted: string) => (xml: string): string =>
  xml.replace(anchor, `${inserted}${anchor}`);

/** The constructs #1026 names, each with the element spelling the output carries. */
const LAYOUT_CONSTRUCTS: ReadonlyArray<{ name: string; element: string; character: string }> = [
  { name: 'w:tab', element: '<w:tab/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.tab },
  { name: 'w:br', element: '<w:br/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.lineBreak },
  { name: 'w:br page', element: '<w:br w:type="page"/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.pageBreak },
  { name: 'w:br column', element: '<w:br w:type="column"/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.columnBreak },
  { name: 'w:cr', element: '<w:cr/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.lineBreak },
  { name: 'w:noBreakHyphen', element: '<w:noBreakHyphen/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.noBreakHyphen },
  { name: 'w:softHyphen', element: '<w:softHyphen/>', character: ROUND_TRIP_LAYOUT_CHARACTERS.softHyphen },
];

function layoutBody(element: string): string {
  return para(run(text('1.') + element + text('Term')));
}

/** The comparison the gate runs over two source-side documents. */
function gateTextsMatch(expectedXml: string, actualXml: string): boolean {
  return compareTexts(
    extractRoundTripComparisonText(expectedXml, { layoutCharacters: true }),
    extractRoundTripComparisonText(actualXml, { layoutCharacters: true }),
    normalizeLayoutPreservingText,
  ).normalizedIdentical;
}

function documentXml(body: string): string {
  return '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}<w:sectPr/></w:body></w:document>`;
}

describe('publication gate: run-content layout characters (#1026)', () => {
  for (const construct of LAYOUT_CONSTRUCTS) {
    test.openspec('Dropping or adding a layout character fails the text check')(
      `dropping ${construct.name} from the output fails acceptText and rejectText`,
      async ({ given, when, then, and }: AllureBddContext) => {
        const body = layoutBody(construct.element);
        let dropped!: GateOutcome;
        let untouched!: GateOutcome;
        await given(`a document whose numbered heading carries ${construct.name}`, () => undefined);
        await when('the comparison output loses that element before the gate reads it', async () => {
          dropped = await gateOnTamperedOutput(body, body, dropFirst(construct.element));
          untouched = await gateOnTamperedOutput(body, body, (xml) => xml);
        });
        await then('the gate throws naming the accept and reject text checks', () => {
          expect(dropped.tampered).toBe(true);
          expect(dropped.error).toBeInstanceOf(TaggedPublicationSafetyError);
          expect(dropped.error!.failedChecks).toEqual(expect.arrayContaining(['acceptText', 'rejectText']));
          expect(dropped.error!.checks.acceptText).toBe(false);
          expect(dropped.error!.checks.rejectText).toBe(false);
          expect(dropped.error!.message).toContain('acceptText');
        });
        await and('the same comparison left intact publishes', () => {
          expect(untouched.error).toBeUndefined();
        });
      },
    );

    test.openspec('Dropping or adding a layout character fails the text check')(
      `adding ${construct.name} to the output fails acceptText and rejectText`,
      async ({ given, when, then }: AllureBddContext) => {
        const body = para(run(text('1.') + text('Term')));
        let added!: GateOutcome;
        await given('a heading without any layout element', () => undefined);
        await when(`the comparison output gains ${construct.name}`, async () => {
          added = await gateOnTamperedOutput(body, body, insertBeforeFirst('<w:t xml:space="preserve">Term', construct.element));
        });
        await then('the gate throws naming the text checks', () => {
          expect(added.tampered).toBe(true);
          expect(added.error?.failedChecks).toEqual(expect.arrayContaining(['acceptText', 'rejectText']));
        });
      },
    );

    test(`${construct.name} projects to its stable character, which the historical projection omitted`, async () => {
      const xml = documentXml(layoutBody(construct.element));
      expect(extractRoundTripComparisonText(xml, { layoutCharacters: true })).toBe(`1.${construct.character}Term`);
      // Negative control: the default projection still omits it, which is why
      // the gate had to opt in.
      expect(extractRoundTripComparisonText(xml)).toBe('1.Term');
    });
  }

  test.openspec('Dropping or adding a layout character fails the text check')(
    'losing one of two tabs, or a break that ends the story, still fails',
    async ({ given, when, then }: AllureBddContext) => {
      const twoTabs = documentXml(para(run(text('Name:') + '<w:tab/><w:tab/>' + text('____'))));
      const oneTab = documentXml(para(run(text('Name:') + '<w:tab/>' + text('____'))));
      const tabBesideSpace = documentXml(para(run(text('Name: ') + '<w:tab/>' + text('____'))));
      const spaceOnly = documentXml(para(run(text('Name: ') + text('____'))));
      const endsInBreak = documentXml(para(run(text('Last line') + '<w:br w:type="page"/>')));
      const endsInText = documentXml(para(run(text('Last line'))));
      let results!: boolean[];
      await given('tab and break losses the historical tab-to-space normalization hid', () => undefined);
      await when('each pair is compared as the gate compares them', () => {
        results = [
          gateTextsMatch(twoTabs, oneTab),
          gateTextsMatch(tabBesideSpace, spaceOnly),
          gateTextsMatch(endsInBreak, endsInText),
        ];
      });
      await then('every loss is a difference', () => {
        expect(results).toEqual([false, false, false]);
      });
    },
  );

  test.openspec('Equivalent spellings of a layout character do not fail the text check')(
    'element and literal spellings of one character project alike',
    async ({ given, when, then, and }: AllureBddContext) => {
      const pairs: Array<[string, string]> = [
        // A tab in its own run, and the literal character inside w:t.
        [para(run(text('1.')), run('<w:tab/>'), run(text('Term'))), para(run(text('1.\tTerm')))],
        // w:cr is defined as a w:br with no type and no clear.
        [para(run(text('a') + '<w:cr/>' + text('b'))), para(run(text('a') + '<w:br/>' + text('b')))],
        // textWrapping is the default break type; clear is about floating objects.
        [para(run(text('a') + '<w:br w:type="textWrapping" w:clear="all"/>' + text('b'))), para(run(text('a') + '<w:br/>' + text('b')))],
        [para(run(text('non') + '<w:noBreakHyphen/>' + text('exclusive'))), para(run(text('non‑exclusive')))],
        [para(run(text('opt') + '<w:softHyphen/>' + text('ional'))), para(run(text('opt­ional')))],
        // Tab-stop definitions are paragraph formatting, not characters.
        [
          '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' + run(text('x')) + '</w:p>',
          para(run(text('x'))),
        ],
      ];
      let respelled!: boolean[];
      let lineVersusPage!: boolean;
      await given('pairs Word renders identically', () => undefined);
      await when('each pair is compared as the gate compares them', () => {
        respelled = pairs.map(([left, right]) => gateTextsMatch(documentXml(left), documentXml(right)));
        lineVersusPage = gateTextsMatch(
          documentXml(para(run(text('a') + '<w:br/>' + text('b')))),
          documentXml(para(run(text('a') + '<w:br w:type="page"/>' + text('b')))),
        );
      });
      await then('no re-spelling is a difference', () => {
        expect(respelled).toEqual(pairs.map(() => true));
      });
      await and('a line break turned into a page break still is', () => {
        expect(lineVersusPage).toBe(false);
      });
    },
  );

  test.openspec('Drawings and objects stay outside the text check')(
    'w:drawing, w:pict, w:object, w:ptab and w:pgNum contribute no characters',
    async ({ given, when, then }: AllureBddContext) => {
      const outside = [
        '<w:drawing/>', '<w:pict/>', '<w:object/>',
        '<w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/>', '<w:pgNum/>',
        '<w:lastRenderedPageBreak/>',
      ];
      let projections!: string[];
      await given('run content the text check makes no claim about', () => undefined);
      await when('each is projected', () => {
        projections = outside.map((element) =>
          extractRoundTripComparisonText(documentXml(para(run(text('a') + element + text('b')))), { layoutCharacters: true }));
      });
      await then('each projects as if absent', () => {
        expect(projections).toEqual(outside.map(() => 'ab'));
      });
    },
  );
});

describe('publication gate: paragraph topology (#1027)', () => {
  const head = para(run(text('Head')));
  const tail = para(run(text('Tail')));
  const TERMINAL_LINK = '<w:p><w:hyperlink w:anchor="target">' + run(text('Link text')) + '</w:hyperlink></w:p>';

  test.openspec('Dropping or adding an empty paragraph fails the paragraph topology check')(
    'dropping an empty paragraph from the output fails both topology checks but not the text checks',
    async ({ given, when, then, and }: AllureBddContext) => {
      const body = head + EMPTY_PARAGRAPH + tail;
      let dropped!: GateOutcome;
      await given('a spacer paragraph between two clauses', () => undefined);
      await when('the comparison output loses the spacer before the gate reads it', async () => {
        dropped = await gateOnTamperedOutput(body, body, dropFirst(EMPTY_PARAGRAPH));
      });
      await then('the gate throws naming acceptParagraphTopology and rejectParagraphTopology', () => {
        expect(dropped.tampered).toBe(true);
        expect(dropped.error).toBeInstanceOf(TaggedPublicationSafetyError);
        expect(dropped.error!.failedChecks).toEqual(['acceptParagraphTopology', 'rejectParagraphTopology']);
        expect(dropped.error!.checks.acceptParagraphTopology).toBe(false);
        expect(dropped.error!.checks.rejectParagraphTopology).toBe(false);
      });
      await and('the text checks still pass, so the topology checks are reported separately', () => {
        expect(dropped.error!.checks.acceptText).toBe(true);
        expect(dropped.error!.checks.rejectText).toBe(true);
        expect(dropped.error!.failureDetails?.acceptParagraphTopology).toMatchObject({
          expectedEmptyParagraphCount: 1,
          actualEmptyParagraphCount: 0,
          firstDifferingParagraphIndex: 1,
          expectedParagraphEmpty: true,
          actualParagraphEmpty: false,
          precedingExpectedParagraph: 'Head',
        });
        expect(dropped.error!.firstDiffSummary?.rejectParagraphTopology?.precedingExpectedParagraph).toBe('Head');
      });
    },
  );

  test.openspec('Dropping or adding an empty paragraph fails the paragraph topology check')(
    'adding an empty paragraph to the output fails both topology checks',
    async ({ given, when, then }: AllureBddContext) => {
      const body = head + tail;
      let added!: GateOutcome;
      await given('two adjacent clauses', () => undefined);
      await when('the comparison output gains an empty paragraph between them', async () => {
        added = await gateOnTamperedOutput(body, body, insertBeforeFirst('<w:p><w:r><w:t xml:space="preserve">Tail', EMPTY_PARAGRAPH));
      });
      await then('the gate throws naming both topology checks', () => {
        expect(added.tampered).toBe(true);
        expect(added.error?.failedChecks).toEqual(['acceptParagraphTopology', 'rejectParagraphTopology']);
      });
    },
  );

  test('the topology projection skips text-box paragraphs and counts layout-only paragraphs as content', () => {
    const textBox = '<w:p><w:r><w:pict><w:txbxContent><w:p/><w:p/></w:txbxContent></w:pict></w:r></w:p>';
    expect(extractRoundTripParagraphTopology(documentXml(head + textBox + tail))).toEqual(['Head', '', 'Tail']);
    const pageBreakOnly = documentXml(head + para(run('<w:br w:type="page"/>')) + tail);
    const emptyInstead = documentXml(head + EMPTY_PARAGRAPH + tail);
    expect(compareParagraphTopology(
      extractRoundTripParagraphTopology(pageBreakOnly),
      extractRoundTripParagraphTopology(emptyInstead),
    )).toMatchObject({ firstDifferingParagraphIndex: 1, expectedParagraphEmpty: false, actualParagraphEmpty: true });
    // A paragraph of spaces is empty: the text check already strips them.
    expect(compareParagraphTopology(['A', '  '], ['A', ''])).toBeUndefined();
  });

  test.openspec('Legitimate empty paragraph edits and terminal paragraph cleanup pass the topology check')(
    'real comparisons that add, remove or keep empty and terminal paragraphs publish',
    async ({ given, when, then }: AllureBddContext) => {
      const pairs: Array<[string, string]> = [
        // An empty paragraph removed and one added.
        [head + EMPTY_PARAGRAPH + tail, head + tail],
        [head + tail, head + EMPTY_PARAGRAPH + tail],
        // Terminal paragraph removed and added (#891/#973 terminal cleanup).
        [head + tail, head],
        [head, head + tail],
        // Empty terminal paragraph removed and added.
        [head + EMPTY_PARAGRAPH, head],
        [head, head + EMPTY_PARAGRAPH],
        // Terminal hyperlink paragraph removed and added: the serializer keeps
        // the revision on the final mark, so Accept or Reject leaves an empty
        // final paragraph (pinned below).
        [head + TERMINAL_LINK, head],
        [head, head + TERMINAL_LINK],
        // Terminal paragraph moved to the front, crossing the terminal mark.
        [head + para(run(text('Middle clause stays where it is.'))) + tail,
          tail + para(run(text('Middle clause stays where it is.'))) + head],
        // A tab and a page break edited alongside text.
        [para(run(text('1.') + '<w:tab/>' + text('Term'))), para(run(text('1.') + text('Term') + '<w:br w:type="page"/>'))],
      ];
      const outcomes: Array<{ accepted: string[]; rejected: string[] }> = [];
      await given('legitimate revisions of empty, terminal and layout-bearing paragraphs', () => undefined);
      await when('each pair is compared end to end', async () => {
        for (const [originalBody, revisedBody] of pairs) {
          const result = await compareDocumentsAtomizer(
            await buildDocxFromBodyXml(originalBody),
            await buildDocxFromBodyXml(revisedBody),
            OPTIONS,
          );
          const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
          outcomes.push({
            accepted: extractRoundTripParagraphTopology(acceptAllChanges(xml)),
            rejected: extractRoundTripParagraphTopology(rejectAllChanges(xml)),
          });
        }
      });
      await then('none throws, and each projection keeps its source topology', () => {
        expect(outcomes).toHaveLength(pairs.length);
        pairs.forEach(([originalBody, revisedBody], index) => {
          expect(compareParagraphTopology(
            extractRoundTripParagraphTopology(documentXml(revisedBody)), outcomes[index]!.accepted)).toBeUndefined();
          expect(compareParagraphTopology(
            extractRoundTripParagraphTopology(documentXml(originalBody)), outcomes[index]!.rejected)).toBeUndefined();
        });
      });
    },
  );
  test.openspec('Legitimate empty paragraph edits and terminal paragraph cleanup pass the topology check')(
    'empty paragraphs left at the very end are terminal residue; anywhere else they fail',
    () => {
      expect(compareParagraphTopology(['Head'], ['Head', ''])).toBeUndefined();
      expect(compareParagraphTopology(['Head', ''], ['Head', '', ''])).toBeUndefined();
      expect(compareParagraphTopology([], ['', ''])).toBeUndefined();
      expect(compareParagraphTopology(['Head', 'Tail'], ['Head', '', 'Tail'])).toMatchObject({ firstDifferingParagraphIndex: 1 });
      expect(compareParagraphTopology(['Head', ''], ['Head'])).toMatchObject({ firstDifferingParagraphIndex: 1, actualParagraphEmpty: null });
      expect(compareParagraphTopology(['Head', 'Tail'], ['Head', 'Tail', 'Extra'])).toBeDefined();
    },
  );

  test('characterization: a deleted terminal hyperlink paragraph leaves an empty final paragraph on Accept', async () => {
    // The #891 relocation does not move a terminal mark revision whose
    // paragraph content sits in a hyperlink, so the final paragraph survives
    // Accept empty. LibreOffice Accept All does the same. Follow-up, not
    // fixed here; the topology check reads it as terminal residue.
    const result = await compareDocumentsAtomizer(
      await buildDocxFromBodyXml(head + TERMINAL_LINK), await buildDocxFromBodyXml(head), OPTIONS);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    expect(extractRoundTripParagraphTopology(acceptAllChanges(xml))).toEqual(['Head', '']);
  });

  test.openspec('Legitimate empty paragraph edits and terminal paragraph cleanup pass the topology check')(
    'the emptied shell of a whole inserted or deleted block container is not an extra paragraph',
    async ({ given, when, then }: AllureBddContext) => {
      const control = '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>'
        + para(run(text('Optional rider'))) + '</w:sdtContent></w:sdt>';
      const errors: unknown[] = [];
      await given('a content control added or removed whole between two clauses', () => undefined);
      await when('each direction is compared', async () => {
        for (const [originalBody, revisedBody] of [[head + tail, head + control + tail], [head + control + tail, head + tail]]) {
          try {
            await compareDocumentsAtomizer(
              await buildDocxFromBodyXml(originalBody!), await buildDocxFromBodyXml(revisedBody!), OPTIONS);
          } catch (error) {
            errors.push(error);
          }
        }
      });
      await then('both publish: the shell no revision can wrap is reported, not counted', () => {
        expect(errors).toEqual([]);
      });
    },
  );
});

describe('a tab added, removed or re-segmented at a run edge is redlined', () => {
  /**
   * The gate's first real catch. With unchanged `w:t` text, the equal-text
   * run refinement cut fragments from the revised runs and so carried the
   * revised tabs into both projections: a tab added or removed at a run edge
   * vanished from Reject All, and a tab moved between re-segmented runs (the
   * ILPA TOC entries) was duplicated or lost. The refinement now places
   * tabs by text offset: tabs both sides share stay live, and the extra tabs
   * of either side become a tracked deletion or insertion.
   */
  const cases: ReadonlyArray<[string, string, string]> = [
    ['added before the text', run(text('Hello world')), run('<w:tab/>' + text('Hello world'))],
    ['added after the text', run(text('Hello world')), run(text('Hello world') + '<w:tab/>')],
    ['removed before the text', run('<w:tab/>' + text('Hello world')), run(text('Hello world'))],
    ['joined to the following text', run(text('18.')) + run('<w:tab/>') + run(text('Term of the Fund')),
      run(text('18.')) + run('<w:tab/>' + text('Term of the Fund'))],
    ['split from the following text', run(text('18.')) + run('<w:tab/>' + text('Term of the Fund')),
      run(text('18.')) + run('<w:tab/>') + run(text('Term of the Fund'))],
  ];
  for (const [name, originalRuns, revisedRuns] of cases) {
    test.openspec('A tab added or removed beside unchanged text is redlined')(`a tab ${name} publishes with both projections exact`, async () => {
      const result = await compareDocumentsAtomizer(
        await buildDocxFromBodyXml(para(originalRuns)),
        await buildDocxFromBodyXml(para(revisedRuns)),
        OPTIONS,
      );
      const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
      expect(gateTextsMatch(documentXml(para(revisedRuns)), acceptAllChanges(xml))).toBe(true);
      expect(gateTextsMatch(documentXml(para(originalRuns)), rejectAllChanges(xml))).toBe(true);
      const trackedTabs = ['ins', 'del'].flatMap((kind) =>
        Array.from(parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, kind))
          .filter((wrapper) => wrapper.getElementsByTagNameNS(OOXML.W_NS, 'tab').length > 0));
      expect(trackedTabs.length).toBeGreaterThan(0);
    });
  }
});
