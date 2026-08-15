import { DOMParser } from '@xmldom/xmldom';
import { compareDocuments } from '@usejunior/docx-compare';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Revision Boundary Readability',
    story: 'Issue #851 — keep parenthetical enumerators intact',
    severity: 'normal',
  });

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function directRevisionText(xml: string, tagName: 'w:del' | 'w:ins'): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagName(tagName)).map((wrapper) => wrapper.textContent ?? '');
}

describe('parenthetical enumerator revision boundaries', () => {
  test('keeps an unchanged marker equal and does not end deletion before a closing parenthesis', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('an unchanged marker followed by a deleted parenthetical phrase', async () => {
      const original = await buildDocxFromBodyXml(
        paragraph('(i) deleted text (parenthetical) retained tail'),
      );
      const revised = await buildDocxFromBodyXml(paragraph('(i) retained tail'));
      const compared = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      const archive = await DocxArchive.load(compared.document);
      xml = await archive.getDocumentXml();
    });

    await when('the inplace redline is emitted', async () => {});

    await then('the marker stays equal and the deleted parenthetical is complete', () => {
      const deletions = directRevisionText(xml, 'w:del');
      expect(deletions.join('')).toBe('deleted text (parenthetical) ');
      expect(deletions.every((text) => !text.includes('(i)'))).toBe(true);
      expect(directRevisionText(xml, 'w:ins')).toEqual([]);
    });
  });

  test('keeps the complete enumerator boundary on the committed ILPA §14.7.1 pair', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('the committed ILPA original and revised agreements', async () => {
      const [original, revised] = await Promise.all([
        readFile(join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx')),
        readFile(join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx')),
      ]);
      const compared = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      const archive = await DocxArchive.load(compared.document);
      xml = await archive.getDocumentXml();
    });

    await when('the real-document redline is emitted', async () => {});

    await then('no deletion boundary is stranded immediately before a closing parenthesis', () => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const deletions = Array.from(doc.getElementsByTagName('w:del'));
      const offenders = deletions.flatMap((deletion) => {
        let sibling = deletion.nextSibling;
        while (sibling && sibling.nodeType !== 1) sibling = sibling.nextSibling;
        return sibling?.nodeName === 'w:r' && (sibling.textContent ?? '').startsWith(')')
          ? [{ deletion: deletion.textContent ?? '', following: sibling.textContent ?? '' }]
          : [];
      });
      expect(offenders, JSON.stringify(offenders)).toEqual([]);
    });
  }, 30_000);

  test('does not redline an unchanged enumerator when only nearby prose changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('two unchanged enumerators with a one-word edit in the second item', async () => {
      const original = await buildDocxFromBodyXml(paragraph('(i) alpha beta gamma and (ii) below the threshold'));
      const revised = await buildDocxFromBodyXml(paragraph('(i) alpha beta gamma and (ii) above the threshold'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the nearby prose edit is compared', async () => {});

    await then('only the changed word is revised', () => {
      expect(directRevisionText(xml, 'w:del')).toEqual(['below']);
      expect(directRevisionText(xml, 'w:ins')).toEqual(['above']);
    });
  });

  test('keeps surviving enumerators unchanged when a trailing item is deleted', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('a two-item enumeration reduced to its unchanged first item', async () => {
      const original = await buildDocxFromBodyXml(paragraph('(i) alpha beta gamma delta, and (ii) epsilon zeta eta theta'));
      const revised = await buildDocxFromBodyXml(paragraph('(i) alpha beta gamma delta.'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the trailing item deletion is compared', async () => {});

    await then('the surviving first enumerator is not redlined', () => {
      const revisions = [...directRevisionText(xml, 'w:del'), ...directRevisionText(xml, 'w:ins')];
      expect(revisions.every((text) => text !== '(i)')).toBe(true);
    });
  });

  test('does not redline an enumerator for a punctuation-only item edit', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('two items whose first item only loses a comma', async () => {
      const original = await buildDocxFromBodyXml(paragraph('(i) alpha, beta gamma occurs and (ii) delta epsilon zeta occurs'));
      const revised = await buildDocxFromBodyXml(paragraph('(i) alpha beta gamma occurs and (ii) delta epsilon zeta occurs'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the punctuation edit is compared', async () => {});

    await then('neither unchanged enumerator is revised', () => {
      const revisions = [...directRevisionText(xml, 'w:del'), ...directRevisionText(xml, 'w:ins')];
      expect(revisions.every((text) => text !== '(i)' && text !== '(ii)')).toBe(true);
    });
  });

  test('does not borrow enumerator identity from the following paragraph', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('an unchanged short enumerator paragraph before an edited paragraph', async () => {
      const original = await buildDocxFromBodyXml(paragraph('Clause (i)') + paragraph('Alpha beta gamma.'));
      const revised = await buildDocxFromBodyXml(paragraph('Clause (i)') + paragraph('Delta epsilon gamma.'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the following paragraph is compared', async () => {});

    await then('the unchanged enumerator is absent from all revisions', () => {
      const revisions = [...directRevisionText(xml, 'w:del'), ...directRevisionText(xml, 'w:ins')];
      expect(revisions.every((text) => !text.includes('(i)'))).toBe(true);
    });
  });

  test('keeps a standalone enumerator stable when its item grows', async ({ given, when, then }: AllureBddContext) => {
    let xml = '';
    await given('a standalone item that adds two words after its unchanged marker', async () => {
      const original = await buildDocxFromBodyXml(paragraph('(i) alpha'));
      const revised = await buildDocxFromBodyXml(paragraph('(i) alpha beta gamma'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the item growth is compared', async () => {});

    await then('the unchanged marker is absent from revisions', () => {
      const revisions = [...directRevisionText(xml, 'w:del'), ...directRevisionText(xml, 'w:ins')];
      expect(revisions.every((text) => text !== '(i)')).toBe(true);
    });
  });

  test('keeps short Roman list and prose parentheticals out of unchanged-marker revisions', async ({ given, when, then }: AllureBddContext) => {
    const outputs: string[] = [];
    await given('a one-word list item and a prose Exhibit reference whose following word changes', async () => {
      for (const [before, after] of [
        ['(i) June, (ii) July', '(i) May, (ii) July'],
        ['see Exhibit (v) June', 'see Exhibit (v) May'],
      ] as const) {
        const original = await buildDocxFromBodyXml(paragraph(before));
        const revised = await buildDocxFromBodyXml(paragraph(after));
        const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
        outputs.push(await (await DocxArchive.load(compared.document)).getDocumentXml());
      }
    });

    await when('the short edits are compared', async () => {});

    await then('only the changed month is revised', () => {
      for (const xml of outputs) {
        expect(directRevisionText(xml, 'w:del')).toEqual(['June']);
        expect(directRevisionText(xml, 'w:ins')).toEqual(['May']);
      }
    });
  });

  test('preserves markers across compatible local edits for every marker family', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const outputs: string[] = [];
    await given('numeric, alphabetic, and Roman items with the same one-word edit', async () => {
      for (const [marker, nextMarker] of [
        ['1', '2'],
        ['a', 'b'],
        ['iv', 'v'],
      ]) {
        const original = await buildDocxFromBodyXml(
          paragraph(
            `Lead (${marker}) alpha beta before delta and (${nextMarker}) retained item text remains.`,
          ),
        );
        const revised = await buildDocxFromBodyXml(
          paragraph(
            `Lead (${marker}) alpha beta after delta and (${nextMarker}) retained item text remains.`,
          ),
        );
        const compared = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
        outputs.push(await (await DocxArchive.load(compared.document)).getDocumentXml());
      }
    });

    await when('the compatible spans are aligned', async () => {});

    await then('ordinary token LCS isolates the changed word', () => {
      for (const xml of outputs) {
        expect(directRevisionText(xml, 'w:del')).toEqual(['before']);
        expect(directRevisionText(xml, 'w:ins')).toEqual(['after']);
      }
    });
  });
});
