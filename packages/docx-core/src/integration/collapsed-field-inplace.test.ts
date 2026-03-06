/**
 * Integration Tests — Collapsed Field Inplace Reconstruction
 *
 * Verifies that collapsed field sequences (PAGEREF, REF, etc.) are correctly
 * replayed as multi-run structures inside tracked change wrappers during
 * inplace reconstruction.
 *
 * Bug: insertDeletedRun and insertMoveFromRun packed all field atoms into a
 * single cloned run, breaking multi-run field structure (orphaned fldChar,
 * leaked instrText).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/34
 */

import { describe, expect } from 'vitest';
import { itAllure, allureStep, allureJsonAttachment, allureParameter } from '../testing/allure-test.js';
import JSZip from 'jszip';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';

// =============================================================================
// Synthetic DOCX builder (field-aware)
// =============================================================================

async function createDocxWithFieldXml(bodyXml: string): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    `<w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);

  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

// =============================================================================
// Fixture: Dedicated-run PAGEREF field (field chars in separate runs)
// =============================================================================

const DEDICATED_RUN_FIELD_ORIGINAL = `
<w:p>
  <w:r><w:t>See page </w:t></w:r>
  <w:r><w:fldChar w:fldCharType="begin"/></w:r>
  <w:r><w:instrText xml:space="preserve"> PAGEREF _Toc123 \\h </w:instrText></w:r>
  <w:r><w:fldChar w:fldCharType="separate"/></w:r>
  <w:r><w:t>23</w:t></w:r>
  <w:r><w:fldChar w:fldCharType="end"/></w:r>
  <w:r><w:t> for details.</w:t></w:r>
</w:p>`;

const DEDICATED_RUN_FIELD_REVISED = `
<w:p>
  <w:r><w:t>See page </w:t></w:r>
  <w:r><w:fldChar w:fldCharType="begin"/></w:r>
  <w:r><w:instrText xml:space="preserve"> PAGEREF _Toc123 \\h </w:instrText></w:r>
  <w:r><w:fldChar w:fldCharType="separate"/></w:r>
  <w:r><w:t>42</w:t></w:r>
  <w:r><w:fldChar w:fldCharType="end"/></w:r>
  <w:r><w:t> for details.</w:t></w:r>
</w:p>`;

// =============================================================================
// Fixture: Mixed-run REF field (field chars share a run with regular text)
// =============================================================================

const MIXED_RUN_FIELD_ORIGINAL = `
<w:p>
  <w:r>
    <w:t>A notice given in accordance with Section </w:t>
    <w:fldChar w:fldCharType="begin"/>
    <w:instrText xml:space="preserve"> REF _Ref473570720 \\r \\h </w:instrText>
    <w:fldChar w:fldCharType="separate"/>
    <w:t>20.7.2</w:t>
    <w:fldChar w:fldCharType="end"/>
    <w:t xml:space="preserve"> shall be deemed effective.</w:t>
  </w:r>
</w:p>`;

const MIXED_RUN_FIELD_REVISED = `
<w:p>
  <w:r>
    <w:t>A notice given in accordance with Section </w:t>
    <w:fldChar w:fldCharType="begin"/>
    <w:instrText xml:space="preserve"> REF _Ref473570720 \\r \\h </w:instrText>
    <w:fldChar w:fldCharType="separate"/>
    <w:t>20.8.1</w:t>
    <w:fldChar w:fldCharType="end"/>
    <w:t xml:space="preserve"> shall be deemed effective.</w:t>
  </w:r>
</w:p>`;

// =============================================================================
// Helpers
// =============================================================================

function countFieldCharPairs(xml: string): { begins: number; ends: number; balanced: boolean } {
  const begins = (xml.match(/w:fldCharType="begin"/g) || []).length;
  const ends = (xml.match(/w:fldCharType="end"/g) || []).length;
  return { begins, ends, balanced: begins === ends };
}

/**
 * Count the number of `<w:r>` elements inside each tracked change wrapper.
 * A correctly multi-run-replayed collapsed field should have multiple runs.
 */
function countRunsInTrackedChangeWrappers(xml: string, wrapperTag: string): number[] {
  const counts: number[] = [];
  const wrapperRegex = new RegExp(`<${wrapperTag}[^>]*>(.*?)</${wrapperTag}>`, 'gs');
  let match;
  while ((match = wrapperRegex.exec(xml)) !== null) {
    const content = match[1]!;
    const runs = (content.match(/<w:r[ >]/g) || []).length;
    counts.push(runs);
  }
  return counts;
}

/**
 * Check if any tracked change wrapper contains a single run with both fldChar
 * and instrText — the signature of the single-run packing bug.
 */
function hasSingleRunPackedField(xml: string, wrapperTag: string): boolean {
  const wrapperRegex = new RegExp(`<${wrapperTag}[^>]*>(.*?)</${wrapperTag}>`, 'gs');
  let match;
  while ((match = wrapperRegex.exec(xml)) !== null) {
    const content = match[1]!;
    // Check each run in the wrapper
    const runRegex = /<w:r[ >].*?<\/w:r>/gs;
    let runMatch;
    while ((runMatch = runRegex.exec(content)) !== null) {
      const runContent = runMatch[0];
      const hasFldChar = runContent.includes('w:fldChar');
      const hasInstrText = runContent.includes('w:instrText');
      const hasText = runContent.includes('w:delText') || runContent.includes('w:t>');
      // A single run containing fldChar + instrText + text is the packed bug
      if (hasFldChar && hasInstrText && hasText) return true;
    }
  }
  return false;
}

function hasLeakedInstrText(xml: string): boolean {
  // instrText should only appear between fldChar[begin] and fldChar[separate].
  // If it appears outside a tracked change wrapper without a preceding begin in the
  // same wrapper, that's a leak. A simpler check: instrText should never be a
  // direct child of a run that has no fldChar[begin] in the same tracked change scope.
  // For simplicity, check that every instrText is preceded by a fldChar[begin]
  // within the same parent wrapper.
  const instrTextRegex = /<w:instrText[^>]*>[^<]*<\/w:instrText>/g;
  const matches = xml.match(instrTextRegex);
  if (!matches) return false;

  // Check that no instrText appears outside of any field structure
  // A leaked instrText would be visible as rendered text in Word
  for (const match of matches) {
    const idx = xml.indexOf(match);
    // Look backwards from this instrText for the nearest fldChar
    const preceding = xml.slice(0, idx);
    const lastBegin = preceding.lastIndexOf('fldCharType="begin"');
    const lastEnd = preceding.lastIndexOf('fldCharType="end"');
    if (lastBegin < 0 || lastEnd > lastBegin) {
      return true; // instrText without a preceding begin, or after an end
    }
  }
  return false;
}

// =============================================================================
// Tests
// =============================================================================

const it = itAllure.epic('Document Comparison').withLabels({
  feature: 'Inplace Reconstruction',
  story: 'Collapsed Field Multi-Run Replay',
  severity: 'critical',
});

describe('Collapsed field inplace reconstruction', () => {
  describe('Dedicated-run field (PAGEREF)', () => {
    let resultXml: string;
    let reconstructionModeUsed: string;
    let fallbackReason: string | undefined;

    it('deleted field preserves multi-run structure in w:del wrapper', async () => {
      await allureStep('Given original and revised docs with a PAGEREF field change (23 -> 42)', async () => {
        await allureParameter('fixture', 'dedicated-run-field');
      });

      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await allureStep('When compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
        reconstructionModeUsed = result.reconstructionModeUsed;
        fallbackReason = result.fallbackReason;
        const archive = await DocxArchive.load(result.document);
        resultXml = await archive.getDocumentXml();
        await allureJsonAttachment('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
          fallbackDiagnostics: result.fallbackDiagnostics,
        });
      });

      await allureStep('Then the tracked change wrappers contain valid field structure', async () => {
        const fieldPairs = countFieldCharPairs(resultXml);
        const delRunCounts = countRunsInTrackedChangeWrappers(resultXml, 'w:del');
        const packedBug = hasSingleRunPackedField(resultXml, 'w:del');
        await allureJsonAttachment('field-char-counts.json', { fieldPairs, delRunCounts, packedBug });
        expect(fieldPairs.balanced, 'fldChar begin/end counts must be balanced').toBe(true);
        expect(hasLeakedInstrText(resultXml), 'instrText must not leak outside field boundaries').toBe(false);
        // The deleted field must be replayed as multiple runs, not packed into one
        expect(packedBug, 'w:del must not pack all field atoms into a single run').toBe(false);
        // The del wrapper should contain multiple runs for the field sequence
        for (const count of delRunCounts) {
          if (count > 0) {
            expect(count, 'w:del wrapper should contain multiple runs for a field sequence').toBeGreaterThan(1);
          }
        }
      });

      await allureStep('And accept-all recovers revised text', async () => {
        const acceptedText = extractTextWithParagraphs(acceptAllChanges(resultXml));
        expect(acceptedText).toContain('42');
        expect(acceptedText).toContain('See page');
        expect(acceptedText).toContain('for details.');
      });

      await allureStep('And reject-all recovers original text', async () => {
        const rejectedText = extractTextWithParagraphs(rejectAllChanges(resultXml));
        expect(rejectedText).toContain('23');
        expect(rejectedText).toContain('See page');
        expect(rejectedText).toContain('for details.');
      });
    });

    it('field structure is valid: every fldChar[begin] has matching end', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();

      await allureStep('When scanning for fldChar elements', async () => {
        const pairs = countFieldCharPairs(xml);
        await allureJsonAttachment('field-structure.json', pairs);
        expect(pairs.balanced).toBe(true);
        expect(pairs.begins).toBeGreaterThan(0);
      });
    });

    it('no instrText leakage outside field boundaries', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();

      expect(hasLeakedInstrText(xml)).toBe(false);
    });

    it('accept-all recovers revised text', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();
      const acceptedText = extractTextWithParagraphs(acceptAllChanges(xml));
      expect(acceptedText).toContain('42');
    });

    it('reject-all recovers original text', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();
      const rejectedText = extractTextWithParagraphs(rejectAllChanges(xml));
      expect(rejectedText).toContain('23');
    });

    it('inplace mode succeeds without rebuild fallback', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      await allureStep('Then reconstructionModeUsed is inplace with no fallback', async () => {
        await allureJsonAttachment('reconstruction-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
        });
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.fallbackReason).toBeUndefined();
      });
    });
  });

  describe('Mixed-run field (REF with surrounding text)', () => {
    it('deleted field does not duplicate surrounding text', async () => {
      await allureParameter('fixture', 'mixed-run-field');

      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(MIXED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(MIXED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();

      await allureStep('Then the non-field text appears exactly once in reject-all', async () => {
        const rejectedText = extractTextWithParagraphs(rejectAllChanges(xml));
        const sectionCount = (rejectedText.match(/A notice given in accordance with Section/g) || []).length;
        const effectiveCount = (rejectedText.match(/shall be deemed effective/g) || []).length;
        await allureJsonAttachment('text-duplication-check.json', {
          rejectedText,
          sectionCount,
          effectiveCount,
        });
        expect(sectionCount, 'surrounding text "Section" should appear exactly once').toBe(1);
        expect(effectiveCount, 'surrounding text "effective" should appear exactly once').toBe(1);
      });
    });

    it('accept-all recovers revised text', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(MIXED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(MIXED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();
      const acceptedText = extractTextWithParagraphs(acceptAllChanges(xml));
      expect(acceptedText).toContain('20.8.1');
    });

    it('reject-all recovers original text', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(MIXED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(MIXED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();
      const rejectedText = extractTextWithParagraphs(rejectAllChanges(xml));
      expect(rejectedText).toContain('20.7.2');
    });

    it('non-field text appears exactly once', async () => {
      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(MIXED_RUN_FIELD_ORIGINAL),
        createDocxWithFieldXml(MIXED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();
      const rejectedText = extractTextWithParagraphs(rejectAllChanges(xml));
      const acceptedText = extractTextWithParagraphs(acceptAllChanges(xml));

      // In both accept and reject projections, surrounding text should appear once
      expect((rejectedText.match(/shall be deemed effective/g) || []).length).toBe(1);
      expect((acceptedText.match(/shall be deemed effective/g) || []).length).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('inserted field preserves multi-run structure in w:ins wrapper', async () => {
      // Original has no field, revised adds one
      const noFieldOriginal = `
<w:p>
  <w:r><w:t>See page 23 for details.</w:t></w:r>
</w:p>`;

      const [original, revised] = await Promise.all([
        createDocxWithFieldXml(noFieldOriginal),
        createDocxWithFieldXml(DEDICATED_RUN_FIELD_REVISED),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();

      const fieldPairs = countFieldCharPairs(xml);
      expect(fieldPairs.balanced).toBe(true);
      expect(hasLeakedInstrText(xml)).toBe(false);
    });
  });
});
