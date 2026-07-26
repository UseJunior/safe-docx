import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';
import { compareDocumentsAtomizer, computeAtomizerStats } from './pipeline.js';
import { UnsupportedTextBoxRevisionError } from './textBoxRevisionSafety.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Pipeline Safety Guard Diagnostics' });

async function replacePart(docx: Buffer, path: string, xml: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  zip.file(path, xml);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const TEXT_BOX_NAMESPACES = {
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
} as const;

function paragraphWithTextBox(text: string, paragraphId = '20000001'): string {
  return (
    `<w:p><w:r><w:pict>` +
    `<v:shape id="shape1" o:spid="_x0000_s1026">` +
    `<v:textbox><w:txbxContent>` +
    `<w:p w14:paraId="${paragraphId}" w14:textId="${paragraphId}">` +
    `<w:r><w:t>${text}</w:t></w:r>` +
    `</w:p>` +
    `</w:txbxContent></v:textbox>` +
    `</v:shape></w:pict></w:r></w:p>`
  );
}

describe('pipeline safety and input guards', () => {
  test('fails closed before emitting a revision inside w:txbxContent', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    const failures = new Map<'inplace' | 'rebuild', unknown>();

    await given('a DOCX pair whose only change is text inside one VML text box', async () => {
      original = await buildDocxFromBodyXml(
        paragraphWithTextBox('05 Main Street'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      );
      revised = await buildDocxFromBodyXml(
        paragraphWithTextBox('405 Main Street'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      );
    });

    await when('the pair is compared using both reconstruction modes', async () => {
      for (const reconstructionMode of ['inplace', 'rebuild'] as const) {
        try {
          await compareDocumentsAtomizer(original, revised, { reconstructionMode });
        } catch (error) {
          failures.set(reconstructionMode, error);
        }
      }
    });

    await then('comparison rejects the unsupported text-box revision explicitly', () => {
      for (const reconstructionMode of ['inplace', 'rebuild'] as const) {
        const failure = failures.get(reconstructionMode);
        expect(failure, reconstructionMode).toBeInstanceOf(UnsupportedTextBoxRevisionError);
        expect((failure as Error).message, reconstructionMode).toContain(
          'Tracked revisions inside w:txbxContent are unsupported',
        );
      }
    });

    await and('the diagnostic identifies the affected text-box paragraph', () => {
      for (const reconstructionMode of ['inplace', 'rebuild'] as const) {
        expect(failures.get(reconstructionMode), reconstructionMode).toMatchObject({
          changes: [{
            index: 0,
            originalParagraphId: '20000001',
            revisedParagraphId: '20000001',
          }],
        });
      }
    });
  });

  test('permits body revisions when unchanged text boxes are present', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('a DOCX pair with an unchanged text box and changed body text', async () => {
      original = await buildDocxFromBodyXml(
        `${paragraph('Original body')}${paragraphWithTextBox('05 Main Street')}`,
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      );
      revised = await buildDocxFromBodyXml(
        `${paragraph('Revised body')}${paragraphWithTextBox('05 Main Street')}`,
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      );
    });

    await when('the pair is compared', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        reconstructionMode: 'inplace',
      });
    });

    await then('comparison succeeds without treating the unchanged text box as a change', () => {
      expect(result.document.length).toBeGreaterThan(0);
      expect(result.stats.insertions).toBeGreaterThan(0);
      expect(result.stats.deletions).toBeGreaterThan(0);
    });
  });

  test('rejects a loadable package whose main part has no body', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let failure: unknown;

    await given('one DOCX main part contains a document root without w:body', async () => {
      const seed = await buildDocxFromBodyXml(paragraph('Original'));
      original = await replacePart(
        seed,
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
      );
      revised = await buildDocxFromBodyXml(paragraph('Revised'));
    });

    await when('the atomizer attempts to enter the comparison pass', async () => {
      try {
        await compareDocumentsAtomizer(original, revised);
      } catch (error) {
        failure = error;
      }
    });

    await then('the missing story container is reported explicitly', () => {
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('Could not find w:body in one or both documents');
    });
  });

  test('inplace publication fails closed — the rebuild fallback also rejects a malformed contributing note part', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    // The inplace attempt throws AncillaryStorySafetyError; the pipeline then
    // retries in rebuild mode, whose base archive still carries the corrupted
    // footnotes.xml. The terminal error retains diagnostics from both attempts.
    let original: Buffer;
    let revised: Buffer;
    let failure: unknown;

    await given('the original references a footnote whose contributing XML part is truncated', async () => {
      const originalSeed = await buildDocxFromBodyXml(
        `${paragraph('Shared')}<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      );
      original = await replacePart(
        originalSeed,
        'word/footnotes.xml',
        `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:footnote w:id="1"><w:p>`,
      );
      revised = await buildDocxFromBodyXml(paragraph('Shared'));
    });

    await when('inplace comparison tries to publish the deleted note reference', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
          reconstructionMode: 'inplace',
          moveDetection: { detectMoves: false },
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('publication fails closed with typed ancillary note diagnostics', () => {
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).name).toBe('AncillaryStorySafetyError');
    });

    await and('the diagnostic identifies invalid note-part XML rather than a text mismatch', () => {
      expect(failure).toMatchObject({
        issues: [
          expect.objectContaining({
            code: 'NOTE_PART_XML_INVALID',
            locator: expect.objectContaining({
              normalizedPartPath: 'word/footnotes.xml',
            }),
          }),
        ],
        attempts: [
          {
            reconstructionMode: 'inplace',
            issues: [
              expect.objectContaining({
                code: 'NOTE_PART_XML_INVALID',
              }),
            ],
          },
          {
            reconstructionMode: 'rebuild',
            issues: [
              expect.objectContaining({
                code: 'NOTE_PART_XML_INVALID',
              }),
            ],
          },
        ],
      });
    });
  });

  test('stats ignore changed atoms that have no paragraph identity', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let stats: ReturnType<typeof computeAtomizerStats>;

    await given('inserted and deleted atoms whose ancestors contain no w:p element', () => {
      const part = { uri: 'word/document.xml', contentType: 'text/xml' };
      atoms = [
        {
          sha1Hash: 'deleted',
          correlationStatus: CorrelationStatus.Deleted,
          contentElement: el('w:t', {}, undefined, 'old'),
          ancestorElements: [el('w:r')],
          ancestorUnids: [],
          part,
        },
        {
          sha1Hash: 'inserted',
          correlationStatus: CorrelationStatus.Inserted,
          contentElement: el('w:t', {}, undefined, 'new'),
          ancestorElements: [el('w:r')],
          ancestorUnids: [],
          part,
        },
      ];
    });

    await when('pipeline statistics are computed', () => {
      stats = computeAtomizerStats(atoms);
    });

    await then('the atom and contiguous-range counts still reflect both changes', () => {
      expect(stats).toMatchObject({
        insertedAtoms: 1,
        deletedAtoms: 1,
        insertedRanges: 1,
        deletedRanges: 1,
      });
    });

    await and('neither orphan atom is misreported as a modified paragraph', () => {
      expect(stats.modifiedParagraphs).toBe(0);
    });
  });
});
