/**
 * A text box a user drew once is stored twice, so every ordinal safe-docx
 * reports for it has to count visible boxes rather than stored copies.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/794
 * @see https://github.com/UseJunior/safe-docx/issues/713
 */

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  assertTextBoxContentUnchanged,
  prepareTextBoxStoryComparison,
  UnsupportedTextBoxRevisionError,
} from './textBoxRevisionSafety.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'VML Text-Box Stories',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '19.1.2.22' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

const FIXED_DATE = new Date('2026-08-11T12:00:00Z');

const ALTERNATE_CONTENT_NAMESPACES = {
  namespaces: {
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    v: 'urn:schemas-microsoft-com:vml',
  },
  ignorablePrefixes: ['wps'],
} as const;

/** The DrawingML spelling Word renders. */
function choiceBranch(text: string): string {
  return (
    `<mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic>` +
    `<a:graphicData><wps:wsp><wps:txbx><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></mc:Choice>`
  );
}

/** The VML spelling Word keeps for readers that cannot render the choice. */
function fallbackBranch(text: string): string {
  return (
    `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>`
  );
}

/**
 * One visual text box, stored twice inside one `mc:AlternateContent`, exactly
 * the way Word writes a modern shape. `fallbackText` differs from `text` only
 * in fixtures that deliberately let the two branches disagree.
 */
function twinTextBox(text: string, fallbackText: string = text): string {
  return (
    `<w:p><w:r><mc:AlternateContent>` +
    choiceBranch(text) +
    fallbackBranch(fallbackText) +
    `</mc:AlternateContent></w:r></w:p>`
  );
}

/** One `mc:Choice` box against two `mc:Fallback` boxes: the copies cannot pair. */
function surplusFallbackBox(
  choiceText: string,
  fallbackText: string,
  surplusText: string,
): string {
  return (
    `<w:p><w:r><mc:AlternateContent>` +
    choiceBranch(choiceText) +
    `<mc:Fallback><w:pict>` +
    `<v:shape><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${fallbackText}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></v:shape>` +
    `<v:shape><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${surplusText}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></v:shape>` +
    `</w:pict></mc:Fallback>` +
    `</mc:AlternateContent></w:r></w:p>`
  );
}

/** Two `mc:Choice` boxes against one `mc:Fallback` box. */
function surplusChoiceBox(
  firstText: string,
  surplusText: string,
  fallbackText: string,
): string {
  return (
    `<w:p><w:r><mc:AlternateContent>` +
    `<mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic>` +
    `<a:graphicData><wps:wsp><wps:txbx><w:txbxContent>` +
    `<w:p><w:r><w:t>${firstText}</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></wps:wsp>` +
    `<wps:wsp><wps:txbx><w:txbxContent>` +
    `<w:p><w:r><w:t>${surplusText}</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>` +
    fallbackBranch(fallbackText) +
    `</mc:AlternateContent></w:r></w:p>`
  );
}

/** A pre-2010 VML text box: one stored copy, no alternate content. */
function plainVmlTextBox(text: string): string {
  return (
    `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`
  );
}

function bodyXml(...boxes: string[]): string {
  return boxes.join('');
}

async function documentXmlOf(body: string): Promise<string> {
  const docx = await buildDocxFromBodyXml(
    body,
    [],
    ALTERNATE_CONTENT_NAMESPACES,
  );
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function refusal(
  original: string,
  revised: string,
): UnsupportedTextBoxRevisionError | undefined {
  try {
    assertTextBoxContentUnchanged(original, revised);
    return undefined;
  } catch (error) {
    return error as UnsupportedTextBoxRevisionError;
  }
}

/** Every `w:txbxContent` subtree in the compared output, in storage order. */
function storedCopies(xml: string): string[] {
  return xml
    .split('<w:txbxContent')
    .slice(1)
    .map((slice) => slice.slice(0, slice.indexOf('</w:txbxContent>')));
}

describe('mc:AlternateContent text-box ordinals', () => {
  test(
    'the reported locator names the visible box, not a stored copy',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given(
        'two text boxes each stored as an mc:Choice / mc:Fallback pair',
        () => documentXmlOf(bodyXml(twinTextBox('Charlie'), twinTextBox('Echo'))),
      );
      const revised = await given('only the second box is edited', () =>
        documentXmlOf(bodyXml(twinTextBox('Charlie'), twinTextBox('Foxtrot'))),
      );

      const error = await when('the guard refuses the change', () =>
        refusal(original, revised),
      );

      await then('exactly one changed container is reported', () => {
        expect(error?.changes).toHaveLength(1);
      });
      await and('its ordinal is the second visible box', () => {
        expect(error?.changes[0]?.index).toBe(1);
        expect(error?.message).toContain('word/document.xml#w:txbxContent[1]');
      });
    },
  );

  test(
    'the reported ordinal tracks position rather than collapsing to a constant',
    async ({ given, when, then, and }: AllureBddContext) => {
      // Negative control for the ordinal. An implementation that always
      // reported 0, or that reported the raw storage index, would fail here
      // while still passing the two-box case above.
      const original = await given('three twinned text boxes', () =>
        documentXmlOf(
          bodyXml(
            twinTextBox('Charlie'),
            twinTextBox('Echo'),
            twinTextBox('Foxtrot'),
          ),
        ),
      );
      const revised = await given('only the third box is edited', () =>
        documentXmlOf(
          bodyXml(
            twinTextBox('Charlie'),
            twinTextBox('Echo'),
            twinTextBox('Golf'),
          ),
        ),
      );

      const error = await when('the guard refuses the change', () =>
        refusal(original, revised),
      );

      await then('the third visible box is named', () => {
        expect(error?.changes.map((change) => change.index)).toEqual([2]);
      });
      await and('the raw storage ordinals 4 and 5 are not reported', () => {
        expect(error?.message).not.toContain('w:txbxContent[4]');
        expect(error?.message).not.toContain('w:txbxContent[5]');
      });
    },
  );

  test(
    'a change confined to the unrendered fallback branch is still refused',
    async ({ given, when, then, and }: AllureBddContext) => {
      // The dangerous direction. Counting visually must not make the guard
      // blind to content it never shows: the fallback branch is still bytes in
      // the package that a comparison has to account for.
      const original = await given('a twinned text box with matching branches', () =>
        documentXmlOf(bodyXml(twinTextBox('Charlie'))),
      );
      const revised = await given(
        'the same box with only its mc:Fallback copy edited',
        () => documentXmlOf(bodyXml(twinTextBox('Charlie', 'Delta'))),
      );

      const error = await when('the guard inspects the pair', () =>
        refusal(original, revised),
      );

      await then('the change is not silently accepted', () => {
        expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
      await and('it is attributed to the single visible box', () => {
        expect(error?.changes.map((change) => change.index)).toEqual([0]);
      });
    },
  );

  test(
    'identical documents holding twinned boxes are not reported as changed',
    async ({ given, when, then }: AllureBddContext) => {
      const documentXml = await given('a document with two twinned boxes', () =>
        documentXmlOf(bodyXml(twinTextBox('Charlie'), twinTextBox('Echo'))),
      );

      const error = await when('the guard compares it with itself', () =>
        refusal(documentXml, documentXml),
      );

      await then('nothing is refused', () => {
        expect(error).toBeUndefined();
      });
    },
  );

  test(
    'the redline still lands in every stored copy of the changed box',
    async ({ given, when, then, and }: AllureBddContext) => {
      // Counting visually changes what safe-docx reports, not what it writes.
      // Both stored copies of a twinned box must keep carrying the same
      // revision, or the accept and reject projections disagree with each
      // other and Word shows a redline the package cannot undo.
      const original = await given('two twinned text boxes', () =>
        buildDocxFromBodyXml(
          bodyXml(twinTextBox('Charlie'), twinTextBox('Echo')),
          [],
          ALTERNATE_CONTENT_NAMESPACES,
        ),
      );
      const revised = await given('only the second box is edited', () =>
        buildDocxFromBodyXml(
          bodyXml(twinTextBox('Charlie'), twinTextBox('Foxtrot')),
          [],
          ALTERNATE_CONTENT_NAMESPACES,
        ),
      );

      const compared = await when('the documents are compared in place', () =>
        compareDocumentsAtomizer(original, revised, {
          date: FIXED_DATE,
        }),
      );
      const comparedXml = await (
        await DocxArchive.load(compared.document)
      ).getDocumentXml();
      const copies = storedCopies(comparedXml);

      await then('the comparison stays on the in-place path', () => {
        expect(compared.reconstructionModeUsed).toBe('inplace');
      });
      await and('the unchanged box carries no revision in either copy', () => {
        expect(copies).toHaveLength(4);
        expect(copies[0]).not.toContain('<w:ins ');
        expect(copies[0]).not.toContain('<w:del ');
        expect(copies[1]).not.toContain('<w:ins ');
        expect(copies[1]).not.toContain('<w:del ');
      });
      await and('both copies of the changed box carry the same revision', () => {
        for (const copy of copies.slice(2)) {
          expect(copy).toContain('<w:ins ');
          expect(copy).toContain('<w:del ');
          expect(copy).toContain('Foxtrot');
          expect(copy).toContain('Echo');
        }
      });
    },
  );

  test(
    'a mutation in a surplus fallback copy is refused',
    async ({ given, when, then, and }: AllureBddContext) => {
      // Codex peer review, #794: grouping used to pair copies by position and
      // silently discard whatever a branch held beyond the selected branch's
      // count, so a change in the surplus copy reached no hash at all and the
      // fail-closed guard accepted it.
      const original = await given(
        'one mc:Choice box against two mc:Fallback boxes',
        () => documentXmlOf(surplusFallbackBox('Charlie', 'Charlie', 'Echo')),
      );
      const revised = await given('only the surplus fallback copy is edited', () =>
        documentXmlOf(surplusFallbackBox('Charlie', 'Charlie', 'Foxtrot')),
      );

      const error = await when('the guard inspects the pair', () =>
        refusal(original, revised),
      );

      await then('the change is refused rather than accepted', () => {
        expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
      await and('it is attributed to the one visible box', () => {
        expect(error?.changes.map((change) => change.index)).toEqual([0]);
      });
    },
  );

  test(
    'a mutation in a surplus choice copy is refused',
    async ({ given, when, then }: AllureBddContext) => {
      const original = await given(
        'two mc:Choice boxes against one mc:Fallback box',
        () => documentXmlOf(surplusChoiceBox('Charlie', 'Echo', 'Charlie')),
      );
      const revised = await given('only the surplus choice copy is edited', () =>
        documentXmlOf(surplusChoiceBox('Charlie', 'Foxtrot', 'Charlie')),
      );

      const error = await when('the guard inspects the pair', () =>
        refusal(original, revised),
      );

      await then('the change is refused', () => {
        expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
    },
  );

  test(
    'a mutation reachable only through an empty selected branch is refused',
    async ({ given, when, then }: AllureBddContext) => {
      const shape = (text: string): string =>
        `<w:p><w:r><mc:AlternateContent>` +
        `<mc:Choice Requires="wps"><w:drawing/></mc:Choice>` +
        fallbackBranch(text) +
        `</mc:AlternateContent></w:r></w:p>`;
      const original = await given(
        'an mc:Choice with no text box and a fallback that has one',
        () => documentXmlOf(shape('Charlie')),
      );
      const revised = await given('the fallback copy is edited', () =>
        documentXmlOf(shape('Delta')),
      );

      const error = await when('the guard inspects the pair', () =>
        refusal(original, revised),
      );

      await then('the change is refused', () => {
        expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
    },
  );

  test(
    'a mutation under a non-Choice, non-Fallback MC child is refused',
    async ({ given, when, then }: AllureBddContext) => {
      const shape = (text: string): string =>
        `<w:p><w:r><mc:AlternateContent>` +
        `<mc:Something><w:pict><v:shape><v:textbox><w:txbxContent>` +
        `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
        `</w:txbxContent></v:textbox></v:shape></w:pict></mc:Something>` +
        `</mc:AlternateContent></w:r></w:p>`;
      const original = await given(
        'an mc:AlternateContent child the MCE schema does not define',
        () => documentXmlOf(shape('Charlie')),
      );
      const revised = await given('its text box is edited', () =>
        documentXmlOf(shape('Delta')),
      );

      const error = await when('the guard inspects the pair', () =>
        refusal(original, revised),
      );

      await then('the change is refused rather than walked past', () => {
        expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
    },
  );

  test(
    'a mutation inside a nested unbalanced mc:AlternateContent is refused',
    async ({ given, when, then }: AllureBddContext) => {
      const shape = (text: string): string =>
        `<w:p><w:r><mc:AlternateContent>` +
        `<mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic>` +
        `<a:graphicData><wps:wsp><wps:txbx>` +
        `<mc:AlternateContent>` +
        `<mc:Choice Requires="wps"><w:txbxContent>` +
        `<w:p><w:r><w:t>Charlie</w:t></w:r></w:p></w:txbxContent></mc:Choice>` +
        `<mc:Fallback><w:txbxContent>` +
        `<w:p><w:r><w:t>Charlie</w:t></w:r></w:p></w:txbxContent>` +
        `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>` +
        `</mc:Fallback>` +
        `</mc:AlternateContent>` +
        `</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline>` +
        `</w:drawing></mc:Choice>` +
        fallbackBranch('Charlie') +
        `</mc:AlternateContent></w:r></w:p>`;
      const original = await given('a nested, unbalanced alternate content', () =>
        documentXmlOf(shape('Echo')),
      );
      const revised = await given('its innermost surplus copy is edited', () =>
        documentXmlOf(shape('Foxtrot')),
      );

      const error = await when('the guard inspects the pair', () =>
        refusal(original, revised),
      );

      await then('the change is refused', () => {
        expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
    },
  );

  test(
    'a plain VML text box is unaffected by branch-aware counting',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('a pre-2010 VML text box with no alternate content', () =>
        documentXmlOf(plainVmlTextBox('Charlie')),
      );
      const revised = await given('its text is edited', () =>
        documentXmlOf(plainVmlTextBox('Delta')),
      );

      const error = await when('the guard refuses the change', () =>
        refusal(original, revised),
      );

      await then('the single box is reported once', () => {
        expect(error?.changes).toHaveLength(1);
      });
      await and('at the ordinal it has always had', () => {
        expect(error?.changes[0]?.index).toBe(0);
        expect(error?.message).toContain('word/document.xml#w:txbxContent[0]');
      });
    },
  );
});

describe('mc:AlternateContent cross-document storage shape', () => {
  // Codex peer review, #794: equal *raw* w:txbxContent counts do not imply the
  // two sides store their boxes the same way. Two plain VML boxes and one
  // twinned box both store two copies, so pairing by raw position silently
  // compared the original's second visible box against the revised document's
  // unrendered copy of its first, and reported visible ordinal 0 for it.
  const plan = async (
    originalBody: string,
    revisedBody: string,
  ): Promise<
    | { refused: true; error: UnsupportedTextBoxRevisionError }
    | { refused: false; stories: Array<{ index: number; visualIndex: number }> }
  > => {
    const original = await buildDocxFromBodyXml(
      originalBody,
      [],
      ALTERNATE_CONTENT_NAMESPACES,
    );
    const revised = await buildDocxFromBodyXml(
      revisedBody,
      [],
      ALTERNATE_CONTENT_NAMESPACES,
    );
    try {
      const prepared = await prepareTextBoxStoryComparison(original, revised);
      return {
        refused: false,
        stories: (prepared?.stories ?? []).map((story) => ({
          index: story.index,
          visualIndex: story.visualIndex,
        })),
      };
    } catch (error) {
      return { refused: true, error: error as UnsupportedTextBoxRevisionError };
    }
  };

  test(
    'two plain boxes against one twinned box is refused, not mispaired',
    async ({ given, when, then, and }: AllureBddContext) => {
      const bodies = await given(
        'two plain VML boxes revised into a single twinned box',
        () => ({
          original: bodyXml(plainVmlTextBox('Charlie'), plainVmlTextBox('Echo')),
          revised: bodyXml(twinTextBox('Charlie')),
        }),
      );

      const outcome = await when('a story comparison is prepared', () =>
        plan(bodies.original, bodies.revised),
      );

      await then('the pair is refused', () => {
        expect(outcome.refused).toBe(true);
      });
      await and('the reason names the storage-shape disagreement', () => {
        expect(
          outcome.refused ? outcome.error.changes[0]?.reason : undefined,
        ).toContain('storage shape differs');
      });
    },
  );

  test(
    'one twinned box against two plain boxes is refused',
    async ({ given, when, then }: AllureBddContext) => {
      const bodies = await given(
        'a single twinned box revised into two plain VML boxes',
        () => ({
          original: bodyXml(twinTextBox('Charlie')),
          revised: bodyXml(plainVmlTextBox('Charlie'), plainVmlTextBox('Echo')),
        }),
      );

      const outcome = await when('a story comparison is prepared', () =>
        plan(bodies.original, bodies.revised),
      );

      await then('the pair is refused', () => {
        expect(outcome.refused).toBe(true);
      });
    },
  );

  test(
    'equal raw counts with different alternate-content boundaries is refused',
    async ({ given, when, then }: AllureBddContext) => {
      const bodies = await given(
        'a twin plus a plain box, revised into a plain box plus a twin',
        () => ({
          original: bodyXml(twinTextBox('Charlie'), plainVmlTextBox('Echo')),
          revised: bodyXml(plainVmlTextBox('Charlie'), twinTextBox('Echo')),
        }),
      );

      const outcome = await when('a story comparison is prepared', () =>
        plan(bodies.original, bodies.revised),
      );

      await then('the pair is refused', () => {
        expect(outcome.refused).toBe(true);
      });
    },
  );

  test(
    'matching storage shapes still prepare a story at the visible ordinal',
    async ({ given, when, then, and }: AllureBddContext) => {
      // Negative control for the guard: it must refuse only shapes that really
      // disagree. A guard that refused everything would pass all three cases
      // above and be useless.
      const bodies = await given('two twinned boxes with the second edited', () => ({
        original: bodyXml(twinTextBox('Charlie'), twinTextBox('Echo')),
        revised: bodyXml(twinTextBox('Charlie'), twinTextBox('Foxtrot')),
      }));

      const outcome = await when('a story comparison is prepared', () =>
        plan(bodies.original, bodies.revised),
      );

      await then('the pair is accepted', () => {
        expect(outcome.refused).toBe(false);
      });
      await and('the story reports the second visible box', () => {
        expect(outcome.refused ? [] : outcome.stories).toEqual([
          { index: 2, visualIndex: 1 },
          { index: 3, visualIndex: 1 },
        ]);
      });
    },
  );
});

describe('mc:AlternateContent in a relationship-selected header story', () => {
  // Codex peer review, #794 asked for the analogous header/footer cases: the
  // ancillary path pairs stories by raw position and builds its own locator,
  // so it needs the same visual ordinal and the same storage-shape guard as
  // the main document.
  const HEADER_RELATIONSHIP =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

  const headerXml = (...boxes: string[]): string =>
    `<?xml version="1.0"?>` +
    `<w:hdr xmlns:w="${OOXML.W_NS}"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` xmlns:wp="${ALTERNATE_CONTENT_NAMESPACES.namespaces.wp}"` +
    ` xmlns:a="${ALTERNATE_CONTENT_NAMESPACES.namespaces.a}"` +
    ` xmlns:wps="${ALTERNATE_CONTENT_NAMESPACES.namespaces.wps}"` +
    ` xmlns:v="${ALTERNATE_CONTENT_NAMESPACES.namespaces.v}"` +
    ` mc:Ignorable="w14 wps">` +
    boxes.join('') +
    `</w:hdr>`;

  const headerFixture = async (...boxes: string[]): Promise<Buffer> => {
    const archive = await DocxArchive.load(
      await buildDocxFromBodyXml(
        `<w:p><w:r><w:t>Body</w:t></w:r></w:p>`,
        [],
        ALTERNATE_CONTENT_NAMESPACES,
      ),
    );
    archive.setDocumentXml(
      (await archive.getDocumentXml()).replace(
        '<w:sectPr/>',
        `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>`,
      ).replace(
        '<w:document ',
        `<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `,
      ),
    );
    archive.setFile(
      'word/_rels/document.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdHeader" Type="${HEADER_RELATIONSHIP}" Target="header1.xml"/>` +
        `</Relationships>`,
    );
    archive.setFile('word/header1.xml', headerXml(...boxes));
    return archive.save();
  };

  const prepare = async (
    originalBoxes: string[],
    revisedBoxes: string[],
  ): Promise<
    | { refused: true; error: UnsupportedTextBoxRevisionError }
    | { refused: false; stories: Array<{ index: number; visualIndex: number; partPath: string }> }
  > => {
    try {
      const prepared = await prepareTextBoxStoryComparison(
        await headerFixture(...originalBoxes),
        await headerFixture(...revisedBoxes),
      );
      return {
        refused: false,
        stories: (prepared?.stories ?? []).map((story) => ({
          index: story.index,
          visualIndex: story.visualIndex,
          partPath: story.partPath,
        })),
      };
    } catch (error) {
      return { refused: true, error: error as UnsupportedTextBoxRevisionError };
    }
  };

  test(
    'a changed header text box is reported at its visible ordinal',
    async ({ given, when, then, and }: AllureBddContext) => {
      const boxes = await given('a header holding two twinned text boxes', () => ({
        original: [twinTextBox('Charlie'), twinTextBox('Echo')],
        revised: [twinTextBox('Charlie'), twinTextBox('Foxtrot')],
      }));

      const outcome = await when('the header stories are prepared', () =>
        prepare(boxes.original, boxes.revised),
      );

      await then('the pair is accepted', () => {
        expect(outcome.refused).toBe(false);
      });
      await and('every story for the changed box carries the visible ordinal', () => {
        const stories = outcome.refused ? [] : outcome.stories;
        expect(stories.length).toBeGreaterThan(0);
        expect(stories.every((story) => story.partPath === 'word/header1.xml')).toBe(true);
        expect([...new Set(stories.map((story) => story.visualIndex))]).toEqual([1]);
        expect(stories.map((story) => story.index)).toEqual([2, 3]);
      });
    },
  );

  test(
    'a header whose storage shape changed is refused, not mispaired',
    async ({ given, when, then, and }: AllureBddContext) => {
      // The ancillary storage-shape check is defence in depth. Header parts are
      // paired by canonical content and then by scaffold fingerprint, and a
      // part whose boxes changed spelling has neither in common, so it is
      // refused before the shape check is reached. What matters is that the
      // engine fails closed rather than pairing a plain box against an
      // unrendered mc:Fallback copy.
      const boxes = await given(
        'a header whose two plain boxes become one twinned box',
        () => ({
          original: [plainVmlTextBox('Charlie'), plainVmlTextBox('Echo')],
          revised: [twinTextBox('Charlie')],
        }),
      );

      const outcome = await when('the header stories are prepared', () =>
        prepare(boxes.original, boxes.revised),
      );

      await then('the pair is refused', () => {
        expect(outcome.refused).toBe(true);
      });
      await and('no story was planned against a mismatched copy', () => {
        expect(outcome.refused ? outcome.error.changes.length : 0)
          .toBeGreaterThan(0);
      });
    },
  );
});

describe('mc:AlternateContent namespace hygiene', () => {
  test(
    'the fixture really does bind the wordprocessingShape namespace',
    async ({ given, when, then }: AllureBddContext) => {
      // Guards the fixture itself: a Requires prefix that failed to resolve
      // would send the selector to the fallback and quietly invert every
      // assertion above.
      const documentXml = await given('a twinned text box fixture', () =>
        documentXmlOf(bodyXml(twinTextBox('Charlie'))),
      );

      const declared = await when('the root namespace declarations are read', () =>
        documentXml.includes(
          'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
        ),
      );

      await then('the prefix the mc:Choice requires is in scope', () => {
        expect(declared).toBe(true);
        expect(documentXml).toContain(`xmlns:w="${OOXML.W_NS}"`);
      });
    },
  );
});
