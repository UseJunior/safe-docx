import { describe, expect } from 'vitest';
import { DocxArchive } from '@usejunior/docx-core';
import {
  COMPLETE_NUMPAGES_FIELD,
  COMPLETE_PAGE_FIELD,
  COMPLETE_REF_FIELD,
  buildDocxFromBodyXml,
  completeField,
  fldChar,
  instrText,
  paragraphWithText,
  resultText,
} from '../../testing/ooxml-fixtures.js';
import { testAllure } from '../../testing/allure-test.js';
import {
  AncillaryStorySafetyError,
  evaluateAncillaryFieldSafety,
  type AncillaryNoteMergeResult,
} from './ancillaryFieldSafety.js';

const TEST_FEATURE = 'verify-ancillary-field-stories';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

interface ArchiveOptions {
  footer?: string;
  footnotes?: string;
}

async function archiveWith(options: ArchiveOptions): Promise<DocxArchive> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(paragraphWithText('Body')),
  );
  const footerReference = options.footer
    ? '<w:footerReference w:type="default" r:id="rIdFooter"/>'
    : '';
  archive.setDocumentXml(
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">` +
      `<w:body>${paragraphWithText('Body')}<w:sectPr>${footerReference}</w:sectPr></w:body>` +
      `</w:document>`,
  );
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">` +
      (options.footer
        ? `<Relationship Id="rIdFooter" Type="${R_NS}/footer" Target="footer1.xml"/>`
        : '') +
      `</Relationships>`,
  );
  if (options.footer) archive.setFile('word/footer1.xml', options.footer);
  if (options.footnotes) archive.setFile('word/footnotes.xml', options.footnotes);
  return archive;
}

function footer(fieldXml: string, prefix = 'w'): string {
  return `<${prefix}:ftr xmlns:${prefix}="${W_NS}"><${prefix}:p>${fieldXml}</${prefix}:p></${prefix}:ftr>`;
}

function footnotes(entries: readonly { id: string; type?: string; content: string }[]): string {
  return (
    `<w:footnotes xmlns:w="${W_NS}">` +
    entries.map(({ id, type, content }) =>
      `<w:footnote w:id="${id}"${type ? ` w:type="${type}"` : ''}>` +
        `<w:p>${content}</w:p></w:footnote>`,
    ).join('') +
    `</w:footnotes>`
  );
}

function noteMergeResults(
  footnote?: AncillaryNoteMergeResult,
): ReadonlyMap<'footnote' | 'endnote', AncillaryNoteMergeResult> {
  return new Map(footnote ? [['footnote', footnote]] : []);
}

describe('source-first ancillary canonical inventories', () => {
  test.openspec('[SDX-ANC-EVIDENCE-01] Selected header and footer source inventories match exactly')(
    '[SDX-ANC-EVIDENCE-01] changed canonical range fails closed at its stable locator',
    async () => {
      const base = await archiveWith({
        footer: footer(COMPLETE_PAGE_FIELD + COMPLETE_PAGE_FIELD),
      });
      const result = await archiveWith({
        footer: footer(completeField(' PAGE ', '9') + COMPLETE_PAGE_FIELD),
      });
      const mergeSource = await archiveWith({});

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      })).rejects.toMatchObject({
        name: 'AncillaryStorySafetyError',
        issues: [{
          category: 'canonical_evidence',
          code: 'FIELD_RANGE_CANONICAL_MISMATCH',
          locator: {
            locatorType: 'field_range',
            normalizedPartPath: 'word/footer1.xml',
            paragraphOrdinal: 0,
            eligibleFieldOrdinal: 0,
            instructionKind: 'PAGE',
          },
        }],
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-05] Repeated and excluded ranges are not confused')(
    '[SDX-ANC-EVIDENCE-02] repeated fields use ordinals while nested and cross-paragraph ranges are excluded',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
      const nested =
        fldChar('begin') +
        instrText(' PAGE ') +
        fldChar('begin') +
        instrText(' NUMPAGES ') +
        fldChar('end') +
        fldChar('end');
      const crossParagraph =
        `<w:p>${fldChar('begin')}${instrText(' PAGE ')}</w:p>` +
        `<w:p>${resultText('1')}${fldChar('end')}</w:p>`;
      const repeated = `<w:p>${COMPLETE_PAGE_FIELD}${COMPLETE_PAGE_FIELD}</w:p>`;
      const sourceFooter =
        `<w:ftr xmlns:w="${W_NS}"><w:p>${nested}</w:p>${crossParagraph}${repeated}</w:ftr>`;
      const finalFooter = sourceFooter
        .replaceAll('w:', 'alt:')
        .replace('xmlns:w=', 'xmlns:alt=');
      const base = await archiveWith({ footer: sourceFooter });
      const result = await archiveWith({ footer: finalFooter });
      const mergeSource = await archiveWith({});

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'revised',
        mergeSourceSide: 'original',
        noteMergeResults: noteMergeResults(),
      });

      expect(evidence.ranges).toEqual([
        expect.objectContaining({
          instructionKind: 'PAGE',
          locator: expect.objectContaining({
            paragraphOrdinal: 3,
            eligibleFieldOrdinal: 0,
          }),
        }),
        expect.objectContaining({
          instructionKind: 'PAGE',
          locator: expect.objectContaining({
            paragraphOrdinal: 3,
            eligibleFieldOrdinal: 1,
          }),
        }),
      ]);
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-04] Created parts and collision outcomes have defined provenance')(
    '[SDX-ANC-EVIDENCE-03] created note parts assign imported provenance to reserved and user entries',
    async () => {
      const sourceNotes = footnotes([
        { id: '-1', type: 'separator', content: '<w:r><w:separator/></w:r>' },
        { id: '-2', type: 'continuationSeparator', content: '<w:r><w:continuationSeparator/></w:r>' },
        { id: '5', content: COMPLETE_REF_FIELD },
      ]);
      const base = await archiveWith({});
      const mergeSource = await archiveWith({ footnotes: sourceNotes });
      const result = await archiveWith({ footnotes: sourceNotes });

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults({
          mergedIds: new Set(['5']),
          createdPart: true,
        }),
      });

      expect(evidence.stories.filter((story) => story.storyKind === 'footnote')).toEqual([
        expect.objectContaining({ entryId: '-1', provenance: 'imported' }),
        expect.objectContaining({ entryId: '-2', provenance: 'imported' }),
        expect.objectContaining({ entryId: '5', provenance: 'imported' }),
      ]);
      expect(evidence.ranges).toEqual([
        expect.objectContaining({
          instructionKind: 'REF',
          sourceSide: 'revised',
          provenance: 'imported',
          locator: expect.objectContaining({ entryId: '5' }),
        }),
      ]);
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-01] Selected header and footer source inventories match exactly')(
    '[SDX-ANC-EVIDENCE-04] instruction changes produce a reachable kind diagnostic',
    async () => {
      const base = await archiveWith({ footer: footer(COMPLETE_PAGE_FIELD) });
      const result = await archiveWith({ footer: footer(COMPLETE_NUMPAGES_FIELD) });
      const mergeSource = await archiveWith({});

      const rejection = evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      });
      await expect(rejection).rejects.toBeInstanceOf(AncillaryStorySafetyError);
      await expect(rejection).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'FIELD_RANGE_KIND_MISMATCH',
            locator: expect.objectContaining({
              paragraphOrdinal: 0,
              eligibleFieldOrdinal: 0,
              instructionKind: 'PAGE',
            }),
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-01] Selected header and footer source inventories match exactly')(
    '[SDX-ANC-EVIDENCE-05] structurally missing and extra ranges retain distinct diagnostics',
    async () => {
      const base = await archiveWith({
        footer: `<w:ftr xmlns:w="${W_NS}"><w:p>${COMPLETE_PAGE_FIELD}</w:p>` +
          `<w:p>${COMPLETE_NUMPAGES_FIELD}</w:p></w:ftr>`,
      });
      const result = await archiveWith({
        footer: `<w:ftr xmlns:w="${W_NS}"><w:p>${COMPLETE_PAGE_FIELD}</w:p>` +
          `<w:p>${COMPLETE_REF_FIELD}</w:p><w:p>${COMPLETE_NUMPAGES_FIELD}</w:p></w:ftr>`,
      });
      const mergeSource = await archiveWith({});

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'FIELD_RANGE_MISSING' }),
          expect.objectContaining({ code: 'FIELD_RANGE_EXTRA' }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-02] Duplicate direct note IDs are rejected before mapping')(
    '[SDX-ANC-EVIDENCE-06] numeric-equivalent note IDs reject with a canonical locator',
    async () => {
      const equivalentIds = footnotes([
        { id: '1', content: COMPLETE_REF_FIELD },
        { id: '01', content: COMPLETE_REF_FIELD },
        { id: '+1', content: COMPLETE_REF_FIELD },
      ]);
      const base = await archiveWith({ footnotes: equivalentIds });
      const result = await archiveWith({ footnotes: equivalentIds });
      const mergeSource = await archiveWith({});

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'DUPLICATE_NOTE_ENTRY_ID',
            locator: expect.objectContaining({ entryId: '1' }),
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-02] Duplicate direct note IDs are rejected before mapping')(
    '[SDX-ANC-EVIDENCE-07] invalid note ID lexical forms reject explicitly',
    async () => {
      const invalidIds = footnotes([{ id: '1.0', content: COMPLETE_REF_FIELD }]);
      const base = await archiveWith({ footnotes: invalidIds });
      const result = await archiveWith({ footnotes: invalidIds });
      const mergeSource = await archiveWith({});

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_NOTE_ENTRY_ID',
            locator: expect.objectContaining({ entryId: '1.0' }),
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-02] Duplicate direct note IDs are rejected before mapping')(
    '[SDX-ANC-EVIDENCE-07] non-XML whitespace around a note ID remains lexically invalid',
    async () => {
      const invalidIds = footnotes([{
        id: '&#160;1&#160;',
        content: COMPLETE_REF_FIELD,
      }]);
      const base = await archiveWith({ footnotes: invalidIds });
      const result = await archiveWith({ footnotes: invalidIds });
      const mergeSource = await archiveWith({});

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_NOTE_ENTRY_ID',
            locator: expect.objectContaining({ entryId: '\u00a01\u00a0' }),
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance')(
    '[SDX-ANC-EVIDENCE-08] XML whitespace collapses before integer canonicalization',
    async () => {
      const base = await archiveWith({
        footnotes: footnotes([{
          id: '&#x9;&#xD;&#xA;+01&#x20;',
          content: COMPLETE_REF_FIELD,
        }]),
      });
      const result = await archiveWith({
        footnotes: footnotes([{ id: '1', content: COMPLETE_REF_FIELD }]),
      });
      const mergeSource = await archiveWith({});

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      });

      expect(evidence.ranges).toEqual([
        expect.objectContaining({
          locator: expect.objectContaining({ entryId: '1' }),
          provenance: 'base',
          canonicalMatch: true,
        }),
      ]);
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance')(
    '[SDX-ANC-EVIDENCE-08] numeric note IDs match provenance by integer value',
    async () => {
      const base = await archiveWith({
        footnotes: footnotes([{ id: '01', content: COMPLETE_REF_FIELD }]),
      });
      const result = await archiveWith({
        footnotes: footnotes([{ id: '+1', content: COMPLETE_REF_FIELD }]),
      });
      const mergeSource = await archiveWith({});

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      });
      expect(evidence.ranges).toEqual([
        expect.objectContaining({
          provenance: 'base',
          locator: expect.objectContaining({ entryId: '1' }),
        }),
      ]);
    },
  );

  test
    .openspec('[SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance')
    .openspec('[SDX-ANC-EVIDENCE-06] Unused merge-source defects do not poison evidence')(
    '[SDX-ANC-EVIDENCE-09] unused malformed merge-source notes do not reject',
    async () => {
      const validNotes = footnotes([{ id: '1', content: COMPLETE_REF_FIELD }]);
      const base = await archiveWith({ footnotes: validNotes });
      const result = await archiveWith({ footnotes: validNotes });
      const mergeSource = await archiveWith({
        footnotes: `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="9">`,
      });

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults({
          mergedIds: new Set(),
          createdPart: false,
        }),
      });
      expect(evidence.ranges).toEqual([
        expect.objectContaining({
          instructionKind: 'REF',
          provenance: 'base',
          locator: expect.objectContaining({ entryId: '1' }),
        }),
      ]);
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-06] Unused merge-source defects do not poison evidence')(
    '[SDX-ANC-EVIDENCE-11] unused merge-source duplicate IDs do not reject',
    async () => {
      const validNotes = footnotes([{ id: '1', content: COMPLETE_REF_FIELD }]);
      const base = await archiveWith({ footnotes: validNotes });
      const result = await archiveWith({ footnotes: validNotes });
      const mergeSource = await archiveWith({
        footnotes: footnotes([
          { id: '9', content: COMPLETE_REF_FIELD },
          { id: '+9', content: COMPLETE_REF_FIELD },
        ]),
      });

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults({
          mergedIds: new Set(),
          createdPart: false,
        }),
      });
      expect(evidence.ranges).toHaveLength(1);
      expect(evidence.ranges[0]).toMatchObject({
        provenance: 'base',
        locator: { entryId: '1' },
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-02] Duplicate direct note IDs are rejected before mapping')(
    '[SDX-ANC-EVIDENCE-12] contributing merge-source duplicate IDs reject',
    async () => {
      const sourceNotes = footnotes([
        { id: '9', content: COMPLETE_REF_FIELD },
        { id: '+9', content: COMPLETE_REF_FIELD },
      ]);
      const base = await archiveWith({});
      const result = await archiveWith({
        footnotes: footnotes([{ id: '9', content: COMPLETE_REF_FIELD }]),
      });
      const mergeSource = await archiveWith({ footnotes: sourceNotes });

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults({
          mergedIds: new Set(['9']),
          createdPart: true,
        }),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'DUPLICATE_NOTE_ENTRY_ID',
            locator: expect.objectContaining({
              entryId: '9',
              sourceSide: 'revised',
            }),
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance')(
    '[SDX-ANC-EVIDENCE-10] contributing malformed merge-source notes reject',
    async () => {
      const base = await archiveWith({});
      const result = await archiveWith({
        footnotes: footnotes([{ id: '9', content: COMPLETE_REF_FIELD }]),
      });
      const mergeSource = await archiveWith({
        footnotes: `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="9">`,
      });

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults({
          mergedIds: new Set(['9']),
          createdPart: true,
        }),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'NOTE_PART_XML_INVALID' }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-STORY-02] Reused targets validate once but retain all bindings')(
    '[SDX-ANC-STORY-02] reused target validates once and retains every selecting binding',
    async () => {
      const base = await archiveWith({ footer: footer(COMPLETE_PAGE_FIELD) });
      const result = await archiveWith({ footer: footer(COMPLETE_PAGE_FIELD) });
      const mergeSource = await archiveWith({});
      const twoSectionDocument =
        `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>` +
        `<w:p><w:pPr><w:sectPr>` +
        `<w:footerReference w:type="default" r:id="rIdFooter"/>` +
        `</w:sectPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>` +
        `<w:sectPr><w:footerReference w:type="even" r:id="rIdFooter"/></w:sectPr>` +
        `</w:body></w:document>`;
      base.setDocumentXml(twoSectionDocument);
      result.setDocumentXml(twoSectionDocument);

      const evidence = await evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      });

      expect(evidence.selectedBindings).toHaveLength(2);
      expect(evidence.stories.filter((story) => story.storyKind === 'footer')).toEqual([
        expect.objectContaining({
          normalizedPartPath: 'word/footer1.xml',
          selectingBindings: [
            expect.objectContaining({ sectionOrdinal: 0, role: 'default' }),
            expect.objectContaining({ sectionOrdinal: 1, role: 'even' }),
          ],
        }),
      ]);
      expect(evidence.ranges).toHaveLength(1);
    },
  );

  test.openspec('[SDX-ANC-STORY-03] Every selected story has independent field state')(
    '[SDX-ANC-STORY-03] note entries cannot balance field state across entry boundaries',
    async () => {
      const splitStateNotes = footnotes([
        { id: '1', content: fldChar('begin') + instrText(' REF Clause_1 ') },
        { id: '2', content: fldChar('end') },
      ]);
      const base = await archiveWith({ footnotes: splitStateNotes });
      const result = await archiveWith({ footnotes: splitStateNotes });
      const mergeSource = await archiveWith({});

      await expect(evaluateAncillaryFieldSafety({
        resultArchive: result,
        baseArchive: base,
        mergeSourceArchive: mergeSource,
        baseSide: 'original',
        mergeSourceSide: 'revised',
        noteMergeResults: noteMergeResults(),
      })).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'FIELD_UNCLOSED_DEPTH',
            locator: expect.objectContaining({ entryId: '1' }),
          }),
          expect.objectContaining({
            code: 'FIELD_STRAY_END',
            locator: expect.objectContaining({ entryId: '2' }),
          }),
        ]),
      });
    },
  );
});
