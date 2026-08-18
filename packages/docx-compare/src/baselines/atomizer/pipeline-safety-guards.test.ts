import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer } from './pipeline.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';

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

describe('pipeline safety and input guards', () => {
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
    // Tagged authority has no automatic rebuild fallback. A malformed
    // contributing note therefore fails once with its typed package evidence.
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
      });
    });
  });

});
