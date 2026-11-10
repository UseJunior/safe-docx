/**
 * The header/footer part each section shows, after inheritance and the
 * `w:titlePg` / `w:evenAndOddHeaders` display switches.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 */

import { describe, expect } from 'vitest';
import { OOXML } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  displayedStorySlots,
  effectiveStorySlot,
  evenAndOddHeadersEnabled,
  isBlankStoryPart,
  pageStorySlots,
  resolveEffectiveStoryBindings,
  type EffectiveStoryBindings,
} from './effectiveStoryBindings.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Effective Header/Footer Bindings';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.6' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.1' },
  );

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DATE = 'w:author="Tester" w:date="2026-11-10T00:00:00Z"';

type Role = 'default' | 'first' | 'even';
interface Ref { kind: 'header' | 'footer'; role?: Role; part: string }

/** `part` names both the relationship id (`rId<part>`) and the target (`<part>.xml`). */
const refs = (...list: Ref[]): string =>
  list.map(({ kind, role = 'default', part }) =>
    `<w:${kind}Reference w:type="${role}" r:id="rId${part}"/>`).join('');

const sectPr = (contents = ''): string => `<w:sectPr>${contents}</w:sectPr>`;
const paragraph = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const document = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;
const relationships = (...parts: Array<{ kind: 'header' | 'footer'; part: string }>): string =>
  `<Relationships xmlns="${PKG_NS}">` +
  parts.map(({ kind, part }) => `<Relationship Id="rId${part}" Type="${R_NS}/${kind}" Target="${part}.xml"/>`).join('') +
  `</Relationships>`;
const settings = (contents: string): string =>
  `<?xml version="1.0"?><w:settings xmlns:w="${OOXML.W_NS}">${contents}</w:settings>`;

const PARTS = [
  { kind: 'header' as const, part: 'h1' },
  { kind: 'header' as const, part: 'h2' },
  { kind: 'header' as const, part: 'hFirst' },
  { kind: 'header' as const, part: 'hEven' },
  { kind: 'footer' as const, part: 'f1' },
  { kind: 'footer' as const, part: 'f2' },
  { kind: 'footer' as const, part: 'fFirst' },
];

function resolve(body: string, settingsXml?: string): EffectiveStoryBindings {
  return resolveEffectiveStoryBindings({
    documentXml: document(body),
    relationshipsXml: relationships(...PARTS),
    settingsXml,
  });
}

/** `<section>:<kind>:<role>=<part>[*]` for every displayed slot; `*` marks an inherited part. */
function displayed(bindings: EffectiveStoryBindings): string[] {
  return displayedStorySlots(bindings).map((slot) =>
    `${slot.sectionOrdinal}:${slot.kind}:${slot.role}=` +
    `${slot.targetPath?.replace(/^word\/|\.xml$/gu, '') ?? '-'}${slot.inherited ? '*' : ''}`);
}

describe('effective header/footer bindings', () => {
  test('a section without a reference of a type shows the previous section\'s part', async ({ given, then }: AllureBddContext) => {
    const bindings = await given('three sections; only the first binds a header and footer', () =>
      resolve(
        paragraph('One', sectPr(refs({ kind: 'header', part: 'h1' }, { kind: 'footer', part: 'f1' }))) +
        paragraph('Two', sectPr()) +
        paragraph('Three') + sectPr(refs({ kind: 'footer', part: 'f2' })),
      ));
    await then('later sections inherit each type until they bind their own', () => {
      expect(bindings.ok).toBe(true);
      expect(bindings.sectionCount).toBe(3);
      expect(displayed(bindings)).toEqual([
        '0:header:default=h1', '0:footer:default=f1',
        '1:header:default=h1*', '1:footer:default=f1*',
        '2:header:default=h1*', '2:footer:default=f2',
      ]);
      const inherited = effectiveStorySlot(bindings, { sectionOrdinal: 2, kind: 'header', role: 'default' })!;
      expect(inherited.sourceSectionOrdinal).toBe(0);
      expect(inherited.explicit).toBeUndefined();
      expect(effectiveStorySlot(bindings, { sectionOrdinal: 2, kind: 'footer', role: 'default' })!.explicit?.rid).toBe('rIdf2');
    });
  });

  test('the first section with no reference of a type shows a blank story', async ({ given, then }: AllureBddContext) => {
    const bindings = await given('a single section with no references', () => resolve(paragraph('Body') + sectPr()));
    await then('its default slots resolve to no part', () => {
      expect(displayed(bindings)).toEqual(['0:header:default=-', '0:footer:default=-']);
    });
  });

  test('w:titlePg shows the first-page story, inherited or blank, never the default in its place', async ({ given, then }: AllureBddContext) => {
    const bindings = await given('a cover section and a titled section that binds no first-page header', () =>
      resolve(
        paragraph('Cover', sectPr(refs({ kind: 'header', part: 'h1' }, { kind: 'header', role: 'first', part: 'hFirst' }))) +
        paragraph('Body') + sectPr(`${refs({ kind: 'header', part: 'h2' })}<w:titlePg/>`),
      ));
    await then('the first-page slot shows only where w:titlePg is on, and inherits across a section without it', () => {
      expect(bindings.titlePages).toEqual([false, true]);
      expect(displayed(bindings)).toEqual([
        '0:header:default=h1', '0:footer:default=-',
        '1:header:default=h2', '1:header:first=hFirst*', '1:footer:default=-', '1:footer:first=-',
      ]);
      // The hidden first-page slot of section 0 still resolves, so section 1 inherits through it.
      expect(effectiveStorySlot(bindings, { sectionOrdinal: 0, kind: 'header', role: 'first' })).toMatchObject({
        displayed: false,
        targetPath: 'word/hFirst.xml',
      });
    });
  });

  test('an explicit w:titlePg w:val="0" is off', async ({ given, then }: AllureBddContext) => {
    const bindings = await given('a section that switches the first-page story off explicitly', () =>
      resolve(paragraph('Body') + sectPr(`${refs({ kind: 'header', role: 'first', part: 'hFirst' })}<w:titlePg w:val="0"/>`)));
    await then('the first-page slot is not displayed', () => {
      expect(bindings.titlePages).toEqual([false]);
      expect(displayed(bindings)).toEqual(['0:header:default=-', '0:footer:default=-']);
    });
  });

  test('w:evenAndOddHeaders in the settings part shows even-page stories', async ({ given, then }: AllureBddContext) => {
    const body =
      paragraph('One', sectPr(refs({ kind: 'header', part: 'h1' }, { kind: 'header', role: 'even', part: 'hEven' }))) +
      paragraph('Two') + sectPr();
    const on = await given('even and odd headers turned on', () => resolve(body, settings('<w:evenAndOddHeaders/>')));
    const off = await given('the same document without the setting', () => resolve(body, settings('')));
    await then('the even slot is displayed, and inherited, only under the setting', () => {
      expect(evenAndOddHeadersEnabled(settings('<w:evenAndOddHeaders w:val="true"/>'))).toBe(true);
      expect(evenAndOddHeadersEnabled(settings('<w:evenAndOddHeaders w:val="false"/>'))).toBe(false);
      expect(evenAndOddHeadersEnabled(null)).toBe(false);
      expect(displayed(on)).toEqual([
        '0:header:default=h1', '0:header:even=hEven', '0:footer:default=-', '0:footer:even=-',
        '1:header:default=h1*', '1:header:even=hEven*', '1:footer:default=-', '1:footer:even=-',
      ]);
      expect(displayed(off)).toEqual([
        '0:header:default=h1', '0:footer:default=-',
        '1:header:default=h1*', '1:footer:default=-',
      ]);
    });
  });

  test('inheritance follows references, not explicit-reference equality', async ({ given, then }: AllureBddContext) => {
    const inherited = await given('a final section that inherits the first section\'s footer', () =>
      resolve(paragraph('One', sectPr(refs({ kind: 'footer', part: 'f1' }))) + paragraph('Two') + sectPr()));
    const explicit = await given('the same pages with the footer named again on the final section', () =>
      resolve(paragraph('One', sectPr(refs({ kind: 'footer', part: 'f1' }))) + paragraph('Two') + sectPr(refs({ kind: 'footer', part: 'f1' }))));
    await then('both show the same part on every displayed slot', () => {
      const parts = (bindings: EffectiveStoryBindings) =>
        displayedStorySlots(bindings).map((slot) => `${slot.sectionOrdinal}:${slot.kind}:${slot.role}=${slot.targetPath ?? '-'}`);
      expect(parts(inherited)).toEqual(parts(explicit));
    });
  });

  test('Accept All of a removed boundary carries its references, and the result resolves as Word shows it', async ({ given, when, then }: AllureBddContext) => {
    const tracked = await given('a deleted paragraph mark owning a section that binds f1, over a final section with no references', () =>
      paragraph('One', `<w:rPr><w:del w:id="1" ${DATE}/></w:rPr>${sectPr(refs({ kind: 'footer', part: 'f1' }))}`) +
      paragraph('Two') + sectPr());
    const accepted = await when('all changes are accepted', () => resolveEffectiveStoryBindings({
      documentXml: acceptAllChanges(document(tracked)),
      relationshipsXml: relationships(...PARTS),
    }));
    const rejected = await when('all changes are rejected', () => resolveEffectiveStoryBindings({
      documentXml: rejectAllChanges(document(tracked)),
      relationshipsXml: relationships(...PARTS),
    }));
    await then('the surviving section shows f1 by its own (carried) reference after Accept All', () => {
      expect(displayed(accepted)).toEqual(['0:header:default=-', '0:footer:default=f1']);
    });
    await then('both sections show f1 after Reject All, the second by inheritance', () => {
      expect(displayed(rejected)).toEqual([
        '0:header:default=-', '0:footer:default=f1',
        '1:header:default=-', '1:footer:default=f1*',
      ]);
    });
  });

  test('section ordinals skip w:sectPrChange snapshots, as auditSectPr numbers them', async ({ given, then }: AllureBddContext) => {
    const bindings = await given('a section whose history snapshot sets w:titlePg', () =>
      resolve(paragraph('Body') + sectPr(
        `${refs({ kind: 'header', role: 'first', part: 'hFirst' })}<w:sectPrChange w:id="2" ${DATE}><w:sectPr><w:titlePg/></w:sectPr></w:sectPrChange>`,
      )));
    await then('there is one section, and the snapshot does not switch its first page on', () => {
      expect(bindings.sectionCount).toBe(1);
      expect(bindings.titlePages).toEqual([false]);
      expect(effectiveStorySlot(bindings, { sectionOrdinal: 1, kind: 'header', role: 'default' })).toBeUndefined();
    });
  });

  test('a dangling reference is reported and left unresolved', async ({ given, then }: AllureBddContext) => {
    const bindings = await given('a footer reference with no relationship', () =>
      resolve(paragraph('Body') + sectPr('<w:footerReference w:type="default" r:id="rIdMissing"/>')));
    await then('the audit issue is surfaced and the slot shows no part', () => {
      expect(bindings.ok).toBe(false);
      expect(bindings.issues.map((issue) => issue.type)).toContain('sectpr_reference_dangling_rid');
      expect(displayed(bindings)).toEqual(['0:header:default=-', '0:footer:default=-']);
    });
  });

  test('blank story parts', async ({ then }: AllureBddContext) => {
    const footer = (content: string): string =>
      `<w:ftr xmlns:w="${OOXML.W_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">${content}</w:ftr>`;
    await then('empty paragraphs and emptied text-box carriers are blank', () => {
      expect(isBlankStoryPart(footer('<w:p/><w:p><w:r><w:t xml:space="preserve">  </w:t></w:r></w:p>'))).toBe(true);
      expect(isBlankStoryPart(footer(
        '<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>',
      ))).toBe(true);
    });
    await then('text, text-box text and graphics that are not text boxes are not blank', () => {
      expect(isBlankStoryPart(footer(paragraph('Page')))).toBe(false);
      expect(isBlankStoryPart(footer(
        `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${paragraph('Boxed')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`,
      ))).toBe(false);
      expect(isBlankStoryPart(footer('<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>'))).toBe(false);
    });
    await then('an emptied table that draws nothing is blank', () => {
      expect(isBlankStoryPart(footer(
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
          '<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/>',
      ))).toBe(true);
    });
    await then('borders set to nil or none and clear automatic shading draw nothing', () => {
      // Review round 2 of PR #1409: Word writes these on unbordered tables and unshaded paragraphs.
      const noEdges = (tag: string, style: string): string =>
        `<w:${tag}>${['top', 'left', 'bottom', 'right'].map((edge) => `<w:${edge} w:val="${style}"/>`).join('')}</w:${tag}>`;
      for (const style of ['nil', 'none']) {
        expect(isBlankStoryPart(footer(
          `<w:tbl><w:tblPr>${noEdges('tblBorders', style)}</w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>` +
            `<w:tr><w:tc><w:tcPr>${noEdges('tcBorders', style)}<w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>` +
            `<w:p><w:pPr>${noEdges('pBdr', style)}<w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:pPr></w:p>`,
        )), style).toBe(true);
      }
      expect(isBlankStoryPart(footer(
        `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="nil"/><w:bottom w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>`,
      ))).toBe(false);
      expect(isBlankStoryPart(footer('<w:p><w:pPr><w:shd w:val="solid" w:color="auto" w:fill="auto"/></w:pPr></w:p>'))).toBe(false);
    });
    await then('a twin text box whose branches are both emptied is blank', () => {
      expect(isBlankStoryPart(footer(
        '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
          '<mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:extent cx="1" cy="1"/>' +
          '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData>' +
          '<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx>' +
          '<w:txbxContent><w:p/></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>' +
          '<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>' +
          '</mc:AlternateContent></w:r></w:p>',
      ))).toBe(true);
    });
    await then('content without text is not blank: bordered, styled or shaded tables, borders, shading, page numbers, fields, pictures', () => {
      // Review of PR #1409: each of these shows on the page with no text.
      for (const content of [
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>',
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12"/></w:pBdr></w:pPr></w:p>',
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>',
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="FF0000"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/>',
        '<w:p><w:pPr><w:shd w:val="clear" w:fill="FF0000"/></w:pPr></w:p>',
        '<w:p><w:r><w:pgNum/></w:r></w:p>',
        '<w:p><w:r><w:noBreakHyphen/></w:r></w:p>',
        '<w:p><w:fldSimple w:instr=" PAGE "/></w:p>',
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        `<w:p><w:r><w:pict><v:shape><v:imagedata r:id="rIdImage" xmlns:r="${R_NS}"/></v:shape><v:shape><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`,
        '<w:p><w:r><w:pict><v:line from="0,0" to="100pt,0"/><v:shape><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>',
        '<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:pgNum/></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>',
      ]) {
        expect(isBlankStoryPart(footer(content)), content).toBe(false);
      }
    });
  });

  test('each kind of page uses the story its section\'s display switches select', async ({ given, then }: AllureBddContext) => {
    const body =
      paragraph('One', sectPr(refs({ kind: 'footer', part: 'f1' }, { kind: 'footer', role: 'first', part: 'fFirst' }) + '<w:titlePg/>')) +
      paragraph('Two') + sectPr();
    const pages = (bindings: EffectiveStoryBindings): string[] =>
      pageStorySlots(bindings)
        .filter(({ slot }) => slot.kind === 'footer')
        .map(({ page, slot }) => `${slot.sectionOrdinal}:${page}=${slot.targetPath?.replace(/^word\/|\.xml$/gu, '') ?? '-'}`);
    const off = await given('different even pages turned off', () => resolve(body, settings('')));
    const on = await given('different even pages turned on', () => resolve(body, settings('<w:evenAndOddHeaders/>')));
    await then('without the setting even pages use the default story; with it, the even story, blank when there is none', () => {
      expect(pages(off)).toEqual(['0:first=fFirst', '0:odd=f1', '0:even=f1', '1:first=f1', '1:odd=f1', '1:even=f1']);
      expect(pages(on)).toEqual(['0:first=fFirst', '0:odd=f1', '0:even=-', '1:first=f1', '1:odd=f1', '1:even=-']);
    });
  });
});
