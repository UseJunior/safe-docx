import { describe, expect } from 'vitest';
import {
  AncillaryStorySafetyError,
  compareDocuments,
  type AncillaryFieldRangeEvidence,
} from '@usejunior/docx-compare';
import {
  COMPLETE_NUMPAGES_FIELD,
  COMPLETE_PAGE_FIELD,
  COMPLETE_PAGEREF_FIELD,
  COMPLETE_REF_FIELD,
  buildDocxWithAncillaryParts,
  paragraphWithText,
  type AncillaryPartFixture,
} from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';

const TEST_FEATURE = 'verify-ancillary-field-stories';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const FOOTNOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const ENDNOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

function footerXml(field: string): string {
  return `<w:ftr xmlns:w="${W_NS}"><w:p>${field}</w:p></w:ftr>`;
}

function notePartXml(
  kind: 'footnote' | 'endnote',
  entries: readonly { id: string; content: string }[],
): string {
  const root = `${kind}s`;
  return (
    `<w:${root} xmlns:w="${W_NS}">` +
    entries.map(({ id, content }) =>
      `<w:${kind} w:id="${id}"><w:p>${content}</w:p></w:${kind}>`,
    ).join('') +
    `</w:${root}>`
  );
}

function noteReference(kind: 'footnote' | 'endnote', id: string): string {
  return `<w:p><w:r><w:t>Clause</w:t><w:${kind}Reference w:id="${id}"/></w:r></w:p>`;
}

interface PackageOptions {
  text: string;
  header?: string;
  footer?: string;
  footnotes?: string;
  endnotes?: string;
  extraParts?: readonly AncillaryPartFixture[];
  footerRelationshipType?: string;
  bodyXml?: string;
}

async function buildPackage(options: PackageOptions): Promise<Buffer> {
  const parts: AncillaryPartFixture[] = [...(options.extraParts ?? [])];
  const relationships = [];
  const sectionReferences: string[] = [];

  if (options.header) {
    parts.push({
      path: 'word/header1.xml',
      contentType: HEADER_CONTENT_TYPE,
      xml: options.header,
    });
    relationships.push({
      id: 'rIdHeader',
      type: `${REL_BASE}/header`,
      target: 'header1.xml',
    });
    sectionReferences.push(
      '<w:headerReference w:type="default" r:id="rIdHeader"/>',
    );
  }
  if (options.footer) {
    parts.push({
      path: 'word/footer1.xml',
      contentType: FOOTER_CONTENT_TYPE,
      xml: options.footer,
    });
    relationships.push({
      id: 'rIdFooter',
      type: options.footerRelationshipType ?? `${REL_BASE}/footer`,
      target: 'footer1.xml',
    });
    sectionReferences.push(
      '<w:footerReference w:type="default" r:id="rIdFooter"/>',
    );
  }
  if (options.footnotes) {
    parts.push({
      path: 'word/footnotes.xml',
      contentType: FOOTNOTES_CONTENT_TYPE,
      xml: options.footnotes,
    });
    relationships.push({
      id: 'rIdFootnotes',
      type: `${REL_BASE}/footnotes`,
      target: 'footnotes.xml',
    });
  }
  if (options.endnotes) {
    parts.push({
      path: 'word/endnotes.xml',
      contentType: ENDNOTES_CONTENT_TYPE,
      xml: options.endnotes,
    });
    relationships.push({
      id: 'rIdEndnotes',
      type: `${REL_BASE}/endnotes`,
      target: 'endnotes.xml',
    });
  }

  return buildDocxWithAncillaryParts({
    bodyXml: options.bodyXml ?? paragraphWithText(options.text),
    sectPrXml: `<w:sectPr>${sectionReferences.join('')}</w:sectPr>`,
    relationships,
    parts,
  });
}

function evidenceRanges(
  result: Awaited<ReturnType<typeof compareDocuments>>,
): AncillaryFieldRangeEvidence[] {
  expect(result.ancillaryFieldEvidence?.status).toBe('passed');
  expect(result.ancillaryFieldEvidence?.reconstructionMode)
    .toBe(result.reconstructionModeUsed);
  return result.ancillaryFieldEvidence!.ranges;
}

describe('ancillary field story publication boundary', () => {
  test
    .openspec('[SDX-ANC-STORY-01] Valid section bindings select header and footer targets')
    .openspec('[SDX-ANC-STORY-04] Invalid selected bindings fail and unreferenced malformed parts do not')(
    '[SDX-ANC-PACKAGE-01] relationship-selected stories satisfy the canonical-range metamorphic invariant',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.44' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.42' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' });
      const footnotes = notePartXml('footnote', [
        { id: '1', content: COMPLETE_REF_FIELD + COMPLETE_PAGEREF_FIELD },
      ]);
      const original = await buildPackage({
        text: 'Original',
        header: `<w:hdr xmlns:w="${W_NS}"><w:p>${COMPLETE_NUMPAGES_FIELD}</w:p></w:hdr>`,
        footer: footerXml(COMPLETE_PAGE_FIELD + COMPLETE_NUMPAGES_FIELD),
        footnotes,
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Original'),
        extraParts: [{
          path: 'word/header-unreferenced.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
          xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
        }],
      });
      const revised = await buildPackage({
        text: 'Revised',
        header: `<w:hdr xmlns:w="${W_NS}"><w:p>${COMPLETE_NUMPAGES_FIELD}</w:p></w:hdr>`,
        footer: footerXml(COMPLETE_PAGE_FIELD + COMPLETE_NUMPAGES_FIELD),
        footnotes,
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Revised'),
        extraParts: [{
          path: 'word/header-unreferenced.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
          xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
        }],
      });

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      const ranges = evidenceRanges(result);

      expect(result.reconstructionModeUsed).toBe('inplace');
      expect(result.ancillaryFieldEvidence?.selectedBindings).toEqual([
        {
          sectionOrdinal: 0,
          kind: 'header',
          role: 'default',
          relationshipId: 'rIdHeader',
          normalizedPartPath: 'word/header1.xml',
        },
        {
          sectionOrdinal: 0,
          kind: 'footer',
          role: 'default',
          relationshipId: 'rIdFooter',
          normalizedPartPath: 'word/footer1.xml',
        },
      ]);
      expect(ranges.map((range) => range.instructionKind)).toEqual([
        'PAGE',
        'NUMPAGES',
        'NUMPAGES',
        'REF',
        'PAGEREF',
      ]);
      expect(ranges.every((range) =>
        range.canonicalMatch &&
        range.provenance === 'base' &&
        range.sourceSide === 'revised',
      )).toBe(true);
    },
  );

  test
    .openspec('[SDX-ANC-FAIL-01] Ancillary failure itself triggers inplace fallback')
    .openspec('[SDX-ANC-FAIL-02] Successful fallback recomputes all ancillary evidence')(
    '[SDX-ANC-PACKAGE-02] selected malformed inplace story causes one rebuild fallback',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
      const original = await buildPackage({
        text: 'Original',
        footer: footerXml(COMPLETE_PAGE_FIELD),
      });
      const revised = await buildPackage({
        text: 'Revised',
        footer: footerXml(
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' + COMPLETE_PAGE_FIELD,
        ),
      });

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
      });

      expect(result.reconstructionModeUsed).toBe('rebuild');
      expect(result.fallbackReason).toBe('ancillary_story_safety_check_failed');
      expect(result.ancillaryFallbackDiagnostics?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'strict_field_structure',
            code: 'FIELD_STRAY_SEPARATOR',
            locator: expect.objectContaining({
              locatorType: 'header_footer_story',
              normalizedPartPath: 'word/footer1.xml',
            }),
          }),
        ]),
      );
      expect(result.fallbackDiagnostics).toBeUndefined();
      expect(result.inplaceSuccessDiagnostics).toBeUndefined();
      expect(evidenceRanges(result)).toEqual([
        expect.objectContaining({
          instructionKind: 'PAGE',
          sourceSide: 'original',
          provenance: 'base',
          canonicalMatch: true,
        }),
      ]);
    },
  );

  test.openspec('[SDX-ANC-FAIL-03] Terminal ancillary failure throws a typed error')(
    '[SDX-ANC-PACKAGE-03] forced rebuild selected-story failure throws a typed error',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
      const malformed =
        '<w:r><w:fldChar w:fldCharType="mystery"/></w:r>' + COMPLETE_PAGE_FIELD;
      const original = await buildPackage({
        text: 'Original',
        footer: footerXml(malformed),
      });
      const revised = await buildPackage({
        text: 'Revised',
        footer: footerXml(COMPLETE_PAGE_FIELD),
      });

      await expect(compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      })).rejects.toMatchObject({
        name: 'AncillaryStorySafetyError',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'FIELD_UNKNOWN_CHAR_TYPE' }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-02] Duplicate direct note IDs are rejected before mapping')(
    '[SDX-ANC-PACKAGE-04] duplicate direct note IDs reject before provenance mapping',
    async () => {
      const duplicateFootnotes = notePartXml('footnote', [
        { id: '1', content: COMPLETE_REF_FIELD },
        { id: '01', content: COMPLETE_PAGEREF_FIELD },
      ]);
      const original = await buildPackage({
        text: 'Original',
        footnotes: duplicateFootnotes,
        bodyXml: noteReference('footnote', '1'),
      });
      const revised = await buildPackage({
        text: 'Revised',
        footnotes: notePartXml('footnote', [{ id: '1', content: COMPLETE_REF_FIELD }]),
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Revised'),
      });

      const rejection = compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
      await expect(rejection).rejects.toBeInstanceOf(AncillaryStorySafetyError);
      await expect(rejection).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            category: 'canonical_evidence',
            code: 'DUPLICATE_NOTE_ENTRY_ID',
            locator: expect.objectContaining({
              locatorType: 'note_entry',
              normalizedPartPath: 'word/footnotes.xml',
              entryId: '1',
              sourceSide: 'original',
            }),
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-STORY-04] Invalid selected bindings fail and unreferenced malformed parts do not')(
    '[SDX-ANC-PACKAGE-05] exact binding type is required at the publication boundary',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.4' });
      const original = await buildPackage({
        text: 'Original',
        footer: footerXml(COMPLETE_PAGE_FIELD),
        footerRelationshipType: `${REL_BASE}/header`,
      });
      const revised = await buildPackage({
        text: 'Revised',
        footer: footerXml(COMPLETE_PAGE_FIELD),
      });

      await expect(compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      })).rejects.toMatchObject({
        name: 'AncillaryStorySafetyError',
        issues: expect.arrayContaining([
          expect.objectContaining({
            category: 'binding_resolution',
            code: 'sectpr_reference_wrong_relationship_type',
          }),
        ]),
      });
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance')(
    '[SDX-ANC-PACKAGE-06] collision-renumbered imported note ranges retain provenance',
    async () => {
      const original = await buildPackage({
        text: 'Original',
        footnotes: notePartXml('footnote', [{ id: '1', content: COMPLETE_REF_FIELD }]),
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Original'),
      });
      const revised = await buildPackage({
        text: 'Revised',
        footnotes: notePartXml('footnote', [{ id: '1', content: COMPLETE_PAGEREF_FIELD }]),
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Revised'),
      });

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
      const ranges = evidenceRanges(result);
      const base = ranges.find((range) => range.instructionKind === 'REF');
      const imported = ranges.find((range) => range.instructionKind === 'PAGEREF');

      expect(base).toMatchObject({
        provenance: 'base',
        sourceSide: 'original',
        locator: { entryId: '1' },
      });
      expect(imported).toMatchObject({
        provenance: 'imported',
        sourceSide: 'revised',
        canonicalMatch: true,
      });
      expect(imported?.locator.entryId).not.toBe('1');
    },
  );

  test.openspec('[SDX-ANC-EVIDENCE-04] Created parts and collision outcomes have defined provenance')(
    '[SDX-ANC-PACKAGE-07] identical same-ID note definitions remain base provenance',
    async () => {
      const notes = notePartXml('endnote', [{ id: '2', content: COMPLETE_REF_FIELD }]);
      const original = await buildPackage({
        text: 'Original',
        endnotes: notes,
        bodyXml: noteReference('endnote', '2') + paragraphWithText('Original'),
      });
      const revised = await buildPackage({
        text: 'Revised',
        endnotes: notes,
        bodyXml: noteReference('endnote', '2') + paragraphWithText('Revised'),
      });

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
      expect(evidenceRanges(result)).toEqual([
        expect.objectContaining({
          instructionKind: 'REF',
          provenance: 'base',
          sourceSide: 'original',
          locator: expect.objectContaining({
            normalizedPartPath: 'word/endnotes.xml',
            entryId: '2',
          }),
        }),
      ]);
    },
  );

  test.openspec('[SDX-ANC-FAIL-03] Terminal ancillary failure throws a typed error')(
    '[SDX-ANC-PACKAGE-08] terminal rebuild fallback failure returns no comparison result',
    async () => {
      const original = await buildPackage({
        text: 'Original',
        footer: footerXml(
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' + COMPLETE_PAGE_FIELD,
        ),
      });
      const revised = await buildPackage({
        text: 'Revised',
        footer: footerXml(
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' + COMPLETE_PAGE_FIELD,
        ),
      });

      await expect(compareDocuments(original, revised, {
        engine: 'atomizer',
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
      })).rejects.toMatchObject({
        name: 'AncillaryStorySafetyError',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'FIELD_STRAY_END' }),
        ]),
      });
    },
  );

  test
    .openspec('[SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance')
    .openspec('[SDX-ANC-EVIDENCE-06] Unused merge-source defects do not poison evidence')(
    '[SDX-ANC-PACKAGE-09] unused malformed merge-source note part does not poison rebuild',
    async () => {
      const validFootnotes = notePartXml('footnote', [
        { id: '1', content: COMPLETE_REF_FIELD },
      ]);
      const original = await buildPackage({
        text: 'Original',
        footnotes: validFootnotes,
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Original'),
      });
      const revised = await buildPackage({
        text: 'Revised',
        footnotes: `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="9">`,
        bodyXml: noteReference('footnote', '1') + paragraphWithText('Revised'),
      });

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });

      expect(result.reconstructionModeUsed).toBe('rebuild');
      expect(evidenceRanges(result)).toEqual([
        expect.objectContaining({
          instructionKind: 'REF',
          sourceSide: 'original',
          provenance: 'base',
          locator: expect.objectContaining({ entryId: '1' }),
        }),
      ]);
    },
  );
});
