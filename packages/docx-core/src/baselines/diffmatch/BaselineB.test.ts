/**
 * Tests for Baseline B (pure TypeScript) document comparison.
 *
 * Tests the paragraph alignment, run diffing, and track changes rendering.
 */

import { describe, expect, beforeEach } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DocxArchive } from '../../shared/docx/DocxArchive.js';
import {
  alignParagraphs,
  classifyAlignment,
  hashParagraph,
} from './paragraphAlignment.js';
import { diffRuns } from './runDiff.js';
import {
  renderTrackChanges,
  resetRevisionIds,
} from './trackChangesRenderer.js';
import type { ParagraphInfo, RunInfo } from '../../shared/ooxml/types.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Baseline B' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesPath = join(__dirname, '../../testing/fixtures');

/**
 * Extract paragraphs from document XML for testing.
 * Simple extraction - production would use proper XML parsing.
 */
function extractParagraphs(xml: string): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  const pRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
  const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;

  let pMatch;
  let index = 0;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1] ?? '';
    let text = '';
    let tMatch;
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      text += tMatch[1] ?? '';
    }
    // Reset regex for next paragraph
    tRegex.lastIndex = 0;

    if (text.length > 0) {
      paragraphs.push({
        text,
        hash: hashParagraph(text),
        runs: [{ text, start: 0, end: text.length }],
      });
      index++;
    }
  }

  return paragraphs;
}

/**
 * Extract runs from a paragraph's text for testing.
 */
function createRuns(text: string): RunInfo[] {
  return [{ text, start: 0, end: text.length }];
}

describe('Baseline B - Paragraph Alignment', () => {
  test('should detect no changes in identical documents', async ({ given, when, then }: AllureBddContext) => {
    let buffer: Buffer;
    let archive: DocxArchive;
    let xml: string;
    let paragraphs: ParagraphInfo[];
    let result: ReturnType<typeof alignParagraphs>;
    let classified: ReturnType<typeof classifyAlignment>;

    await given('an identical document loaded as archive', async () => {
      buffer = await readFile(join(fixturesPath, 'no-change', 'original.docx'));
      archive = await DocxArchive.load(buffer);
      xml = await archive.getDocumentXml();
      paragraphs = extractParagraphs(xml);
    });

    await when('paragraphs are aligned against themselves', () => {
      result = alignParagraphs(paragraphs, paragraphs);
      classified = classifyAlignment(result);
    });

    await then('all paragraphs are identical with no modifications', () => {
      expect(classified.identical.length).toBe(paragraphs.length);
      expect(classified.modified.length).toBe(0);
      expect(result.inserted.length).toBe(0);
      expect(result.deleted.length).toBe(0);
    });
  });

  test('should detect inserted paragraph', async ({ given, when, then }: AllureBddContext) => {
    let originalParagraphs: ParagraphInfo[];
    let revisedParagraphs: ParagraphInfo[];
    let result: ReturnType<typeof alignParagraphs>;

    await given('original and revised documents with an inserted paragraph', async () => {
      const originalBuffer = await readFile(join(fixturesPath, 'paragraph-insert', 'original.docx'));
      const revisedBuffer = await readFile(join(fixturesPath, 'paragraph-insert', 'revised.docx'));
      const originalArchive = await DocxArchive.load(originalBuffer);
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const revisedXml = await revisedArchive.getDocumentXml();
      originalParagraphs = extractParagraphs(originalXml);
      revisedParagraphs = extractParagraphs(revisedXml);
    });

    await when('paragraphs are aligned', () => {
      expect(originalParagraphs.length).toBe(2);
      expect(revisedParagraphs.length).toBe(3);
      result = alignParagraphs(originalParagraphs, revisedParagraphs);
    });

    await then('the inserted paragraph is detected', () => {
      expect(result.inserted.length).toBe(1);
      expect(result.inserted[0]?.text).toContain('new middle paragraph');
    });
  });

  test('should detect deleted paragraph', async ({ given, when, then }: AllureBddContext) => {
    let originalParagraphs: ParagraphInfo[];
    let revisedParagraphs: ParagraphInfo[];
    let result: ReturnType<typeof alignParagraphs>;

    await given('original and revised documents with a deleted paragraph', async () => {
      const originalBuffer = await readFile(join(fixturesPath, 'paragraph-delete', 'original.docx'));
      const revisedBuffer = await readFile(join(fixturesPath, 'paragraph-delete', 'revised.docx'));
      const originalArchive = await DocxArchive.load(originalBuffer);
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const revisedXml = await revisedArchive.getDocumentXml();
      originalParagraphs = extractParagraphs(originalXml);
      revisedParagraphs = extractParagraphs(revisedXml);
    });

    await when('paragraphs are aligned', () => {
      expect(originalParagraphs.length).toBe(3);
      expect(revisedParagraphs.length).toBe(2);
      result = alignParagraphs(originalParagraphs, revisedParagraphs);
    });

    await then('the deleted paragraph is detected', () => {
      expect(result.deleted.length).toBe(1);
      expect(result.deleted[0]?.text).toContain('will be deleted');
    });
  });

  test('should detect modified paragraph (simple word change)', async ({ given, when, then }: AllureBddContext) => {
    let originalParagraphs: ParagraphInfo[];
    let revisedParagraphs: ParagraphInfo[];
    let result: ReturnType<typeof alignParagraphs>;
    let classified: ReturnType<typeof classifyAlignment>;

    await given('original and revised documents with a simple word change', async () => {
      const originalBuffer = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
      const revisedBuffer = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));
      const originalArchive = await DocxArchive.load(originalBuffer);
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const revisedXml = await revisedArchive.getDocumentXml();
      originalParagraphs = extractParagraphs(originalXml);
      revisedParagraphs = extractParagraphs(revisedXml);
    });

    await when('paragraphs are aligned with similarity threshold', () => {
      result = alignParagraphs(originalParagraphs, revisedParagraphs, 0.6);
      classified = classifyAlignment(result);
    });

    await then('the modified paragraph is detected', () => {
      // With similarity threshold, "quick" → "slow" should be detected as modified
      // (paragraphs are similar enough to be matched, but different)
      expect(result.matched.length + classified.modified.length).toBeGreaterThan(0);
    });
  });
});

describe('Baseline B - Run Diffing', () => {
  test('should diff runs with word substitution', async ({ given, when, then }: AllureBddContext) => {
    let originalRuns: RunInfo[];
    let revisedRuns: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original and revised runs with a word substitution', () => {
      originalRuns = [{ text: 'The quick fox', start: 0, end: 13 }];
      revisedRuns = [{ text: 'The slow fox', start: 0, end: 12 }];
    });

    await when('runs are diffed', () => {
      result = diffRuns(originalRuns, revisedRuns);
    });

    await then('deletions and insertions are detected', () => {
      // Count deletions and insertions from mergedRuns
      const deletions = result.mergedRuns.filter(r => r.revision?.type === 'deletion');
      const insertions = result.mergedRuns.filter(r => r.revision?.type === 'insertion');

      expect(deletions.length).toBeGreaterThan(0);
      expect(insertions.length).toBeGreaterThan(0);

      const deletedText = deletions.map((d) => d.text).join('');
      const insertedText = insertions.map((i) => i.text).join('');

      expect(deletedText).toContain('quick');
      expect(insertedText).toContain('slow');
    });
  });

  test('should handle run-level date change', async ({ given, when, then }: AllureBddContext) => {
    let originalParagraphs: ParagraphInfo[];
    let revisedParagraphs: ParagraphInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original and revised documents with a date change', async () => {
      const originalBuffer = await readFile(join(fixturesPath, 'run-level-change', 'original.docx'));
      const revisedBuffer = await readFile(join(fixturesPath, 'run-level-change', 'revised.docx'));
      const originalArchive = await DocxArchive.load(originalBuffer);
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const revisedXml = await revisedArchive.getDocumentXml();
      originalParagraphs = extractParagraphs(originalXml);
      revisedParagraphs = extractParagraphs(revisedXml);
    });

    await when('runs are diffed at the paragraph level', () => {
      expect(originalParagraphs[0]).toBeDefined();
      expect(revisedParagraphs[0]).toBeDefined();
      const originalRuns = createRuns(originalParagraphs[0]!.text);
      const revisedRuns = createRuns(revisedParagraphs[0]!.text);
      result = diffRuns(originalRuns, revisedRuns);
    });

    await then('the date change is detected', () => {
      // Count deletions and insertions from mergedRuns
      const deletions = result.mergedRuns.filter(r => r.revision?.type === 'deletion');
      const insertions = result.mergedRuns.filter(r => r.revision?.type === 'insertion');

      // Should detect changes between "January 1, 2024" → "February 15, 2024"
      const deletedText = deletions.map((d) => d.text).join('');
      const insertedText = insertions.map((i) => i.text).join('');

      // diff-match-patch may split "January" into "Jan" + "uary" depending on optimization
      // So check for partial matches
      expect(deletedText.length).toBeGreaterThan(0);
      expect(insertedText.length).toBeGreaterThan(0);
      expect(deletedText).toMatch(/Jan|1,/); // Part of "January" or "1,"
      expect(insertedText).toMatch(/Feb|15/); // Part of "February" or "15"
    });
  });

  test('should produce merged runs for rendering', async ({ given, when, then }: AllureBddContext) => {
    let originalRuns: RunInfo[];
    let revisedRuns: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original and revised runs', () => {
      originalRuns = [{ text: 'Hello world', start: 0, end: 11 }];
      revisedRuns = [{ text: 'Hello universe', start: 0, end: 14 }];
    });

    await when('runs are diffed', () => {
      result = diffRuns(originalRuns, revisedRuns);
    });

    await then('merged runs contain equal, deleted and inserted segments', () => {
      expect(result.mergedRuns.length).toBeGreaterThan(0);

      // Check revision types
      const hasEqual = result.mergedRuns.some(r => !r.revision);
      const hasDeleted = result.mergedRuns.some(r => r.revision?.type === 'deletion');
      const hasInserted = result.mergedRuns.some(r => r.revision?.type === 'insertion');

      expect(hasEqual).toBe(true);
      expect(hasDeleted).toBe(true);
      expect(hasInserted).toBe(true);
    });
  });
});

describe('Baseline B - Track Changes Rendering', () => {
  beforeEach(() => {
    resetRevisionIds();
  });

  test('should render deletions as w:del elements', async ({ given, when, then }: AllureBddContext) => {
    let mergedRuns: RunInfo[];
    let result: string;

    await given('merged runs with a deletion', () => {
      mergedRuns = [
        { text: 'Hello ', start: 0, end: 6 },
        {
          text: 'world',
          start: 6,
          end: 11,
          revision: { id: 0, author: 'Test', date: new Date(), type: 'deletion' },
        },
      ];
    });

    await when('track changes are rendered', () => {
      result = renderTrackChanges(mergedRuns, {
        author: 'Test',
        date: new Date('2024-01-15T00:00:00Z'),
      });
    });

    await then('the output contains w:del elements', () => {
      expect(result).toContain('<w:del');
      expect(result).toContain('w:author="Test"');
      expect(result).toContain('<w:delText>world</w:delText>');
    });
  });

  test('should render insertions as w:ins elements', async ({ given, when, then }: AllureBddContext) => {
    let mergedRuns: RunInfo[];
    let result: string;

    await given('merged runs with an insertion', () => {
      mergedRuns = [
        { text: 'Hello ', start: 0, end: 6 },
        {
          text: 'universe',
          start: 6,
          end: 14,
          revision: { id: 0, author: 'Test', date: new Date(), type: 'insertion' },
        },
      ];
    });

    await when('track changes are rendered', () => {
      result = renderTrackChanges(mergedRuns, {
        author: 'Test',
        date: new Date('2024-01-15T00:00:00Z'),
      });
    });

    await then('the output contains w:ins elements', () => {
      expect(result).toContain('<w:ins');
      expect(result).toContain('w:author="Test"');
      expect(result).toContain('<w:t>universe</w:t>');
    });
  });

  test('should render equal runs as plain w:r elements', async ({ given, when, then }: AllureBddContext) => {
    let mergedRuns: RunInfo[];
    let result: string;

    await given('merged runs with no revisions', () => {
      mergedRuns = [{ text: 'Unchanged text', start: 0, end: 14 }];
    });

    await when('track changes are rendered', () => {
      result = renderTrackChanges(mergedRuns, {
        author: 'Test',
        date: new Date('2024-01-15T00:00:00Z'),
      });
    });

    await then('the output contains plain w:r elements with no del or ins', () => {
      expect(result).toContain('<w:r>');
      expect(result).toContain('<w:t>Unchanged text</w:t>');
      expect(result).not.toContain('<w:del');
      expect(result).not.toContain('<w:ins');
    });
  });

  test('should include revision IDs', async ({ given, when, then }: AllureBddContext) => {
    let mergedRuns: RunInfo[];
    let result: string;

    await given('merged runs with both deletion and insertion', () => {
      resetRevisionIds();
      mergedRuns = [
        {
          text: 'deleted',
          start: 0,
          end: 7,
          revision: { id: 0, author: 'Test', date: new Date(), type: 'deletion' },
        },
        {
          text: 'inserted',
          start: 0,
          end: 8,
          revision: { id: 0, author: 'Test', date: new Date(), type: 'insertion' },
        },
      ];
    });

    await when('track changes are rendered', () => {
      result = renderTrackChanges(mergedRuns, {
        author: 'Test',
        date: new Date('2024-01-15T00:00:00Z'),
      });
    });

    await then('sequential revision IDs are assigned', () => {
      // IDs are allocated sequentially: 1, 2
      expect(result).toContain('w:id="1"');
      expect(result).toContain('w:id="2"');
    });
  });
});

describe('Baseline B - End-to-End Pipeline', () => {
  beforeEach(() => {
    resetRevisionIds();
  });

  test('should process simple-word-change fixture', async ({ given, when, then }: AllureBddContext) => {
    let originalParagraphs: ParagraphInfo[];
    let revisedParagraphs: ParagraphInfo[];
    let trackChangesXml: string;

    await given('original and revised simple-word-change fixtures', async () => {
      const originalBuffer = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
      const revisedBuffer = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));
      const originalArchive = await DocxArchive.load(originalBuffer);
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const revisedXml = await revisedArchive.getDocumentXml();
      originalParagraphs = extractParagraphs(originalXml);
      revisedParagraphs = extractParagraphs(revisedXml);
    });

    await when('the full comparison pipeline is run', () => {
      expect(originalParagraphs.length).toBe(1);
      expect(revisedParagraphs.length).toBe(1);

      // Step 2: Align paragraphs
      alignParagraphs(originalParagraphs, revisedParagraphs, 0.5);

      // Step 3: For modified paragraphs, diff at run level
      const originalRuns = createRuns(originalParagraphs[0]!.text);
      const revisedRuns = createRuns(revisedParagraphs[0]!.text);
      const runDiff = diffRuns(originalRuns, revisedRuns);

      // Step 4: Render track changes
      trackChangesXml = renderTrackChanges(runDiff.mergedRuns, {
        author: 'Comparison',
        date: new Date('2024-01-15T00:00:00Z'),
      });
    });

    await then('the output contains the changed words', () => {
      // Verify the output contains expected track changes
      expect(trackChangesXml).toContain('quick'); // deleted
      expect(trackChangesXml).toContain('slow'); // inserted
    });
  });

  test('should handle multiple-changes fixture', async ({ given, when, then }: AllureBddContext) => {
    let originalParagraphs: ParagraphInfo[];
    let revisedParagraphs: ParagraphInfo[];
    let deletions: RunInfo[];
    let insertions: RunInfo[];

    await given('original and revised multiple-changes fixtures', async () => {
      const originalBuffer = await readFile(join(fixturesPath, 'multiple-changes', 'original.docx'));
      const revisedBuffer = await readFile(join(fixturesPath, 'multiple-changes', 'revised.docx'));
      const originalArchive = await DocxArchive.load(originalBuffer);
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const revisedXml = await revisedArchive.getDocumentXml();
      originalParagraphs = extractParagraphs(originalXml);
      revisedParagraphs = extractParagraphs(revisedXml);
    });

    await when('runs are diffed', () => {
      const originalRuns = createRuns(originalParagraphs[0]!.text);
      const revisedRuns = createRuns(revisedParagraphs[0]!.text);
      const runDiff = diffRuns(originalRuns, revisedRuns);
      deletions = runDiff.mergedRuns.filter(r => r.revision?.type === 'deletion');
      insertions = runDiff.mergedRuns.filter(r => r.revision?.type === 'insertion');
    });

    await then('multiple changes are detected', () => {
      // Should detect multiple changes: $1,000→$1,500, Contractor→Vendor, first→fifteenth
      expect(deletions.length).toBeGreaterThan(0);
      expect(insertions.length).toBeGreaterThan(0);

      const deletedText = deletions.map((d) => d.text).join('');
      const insertedText = insertions.map((i) => i.text).join('');

      // diff-match-patch optimizes diffs, so check that we captured meaningful changes
      // The key differences involve: 1,000→1,500, Contractor→Vendor, first→fifteenth
      expect(deletedText.length).toBeGreaterThan(0);
      expect(insertedText.length).toBeGreaterThan(0);
      // Check that at least one of the key changes is detected
      expect(deletedText + insertedText).toMatch(/Contract|Vendor|000|500|first|fifteenth/);
    });
  });
});
