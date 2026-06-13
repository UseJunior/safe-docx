/**
 * Regression tests for issue #408: a one-paragraph edit must not persist
 * open-time normalization (proofErr stripping, run merging) to untouched
 * paragraphs, so on-disk diffs reflect the edit's actual blast radius.
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import { restoreUntouchedBlocks } from './minimal_save.js';
import { OOXML, W } from './namespaces.js';
import { parseXml } from './xml.js';
import { readZipText } from './zip.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Primitives' });

const serializer = new XMLSerializer();

/** Serialized element children of the document's w:body. */
function bodyBlocks(xml: string): string[] {
  const doc = parseXml(xml);
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
  if (!body) return [];
  const out: string[] = [];
  let child = body.firstChild;
  while (child) {
    if (child.nodeType === 1) out.push(serializer.serializeToString(child as Element));
    child = child.nextSibling;
  }
  return out;
}

function firstTextNode(paragraph: Element): Element {
  const t = paragraph.getElementsByTagNameNS(OOXML.W_NS, W.t).item(0);
  if (!t) throw new Error('Expected a w:t in paragraph');
  return t as Element;
}

// Three Word-shaped paragraphs: P1 and P3 carry volatile proofing markup and
// rsid-fragmented same-format runs (what normalize() rewrites); P2 is the
// edit target.
const P1 =
  `<w:p w14:paraId="0000AAAA"><w:proofErr w:type="spellStart"/><w:r w:rsidR="00AA0001"><w:t>Lorem</w:t></w:r>` +
  `<w:proofErr w:type="spellEnd"/><w:r w:rsidR="00AA0002"><w:t xml:space="preserve"> ipsum</w:t></w:r></w:p>`;
const P2 = `<w:p w14:paraId="0000BBBB"><w:r w:rsidR="00BB0001"><w:t>{placeholder}</w:t></w:r></w:p>`;
const P3 =
  `<w:p w14:paraId="0000CCCC"><w:proofErr w:type="gramStart"/><w:r><w:t>dolor</w:t></w:r>` +
  `<w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve"> sit</w:t></w:r></w:p>`;

async function openLikeASession(bodyXml: string): Promise<{ doc: DocxDocument; originalXml: string }> {
  const buffer = await buildDocxFromBodyXml(bodyXml);
  const originalXml = (await readZipText(buffer, 'word/document.xml'))!;
  const doc = await DocxDocument.load(buffer);
  doc.normalize();
  doc.insertParagraphBookmarks('mcp_test');
  return { doc, originalXml };
}

describe('minimal re-serialization on save (issue #408)', () => {
  test('a single-paragraph edit leaves untouched paragraphs element-identical to the original', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let originalXml = '';
    let savedXml = '';
    let blocksRestored = 0;

    await given('a normalized session over a document with proofErr and fragmented runs', async () => {
      ({ doc, originalXml } = await openLikeASession(P1 + P2 + P3));
    });

    await when('one paragraph is edited and the document is saved minimally', async () => {
      const target = doc.getParagraphs()[1]!;
      firstTextNode(target).textContent = 'two (2) years';
      const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
      blocksRestored = saved.blocksRestored;
      savedXml = (await readZipText(saved.buffer, 'word/document.xml'))!;
    });

    await then('untouched paragraphs keep their original XML and only the edit shows', () => {
      const original = bodyBlocks(originalXml);
      const saved = bodyBlocks(savedXml);
      expect(saved).toHaveLength(original.length);

      // P1 and P3 regain proofErr + separate rsid runs; sectPr untouched.
      expect(saved[0]).toBe(original[0]);
      expect(saved[2]).toBe(original[2]);
      expect(saved[3]).toBe(original[3]);
      // The edited paragraph carries the new text and stays normalized.
      expect(saved[1]).toContain('two (2) years');
      expect(saved[1]).not.toBe(original[1]);
      expect(blocksRestored).toBe(3);

      // The original's volatile markup really was at stake: the normalized
      // session DOM had stripped it.
      expect(original[0]).toContain('proofErr');
      expect(saved[0]).toContain('proofErr');
    });
  });

  test('a zero-edit save round-trips document.xml element-identically', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let originalXml = '';
    let savedXml = '';
    let blocksRestored = 0;

    await given('a normalized session with no edits', async () => {
      ({ doc, originalXml } = await openLikeASession(P1 + P2 + P3));
    });

    await when('the document is saved minimally', async () => {
      const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
      blocksRestored = saved.blocksRestored;
      savedXml = (await readZipText(saved.buffer, 'word/document.xml'))!;
    });

    await then('every block is restored and the document matches the original', () => {
      expect(blocksRestored).toBe(4);
      // Element-identical: both sides pass once through the same serializer.
      expect(savedXml).toBe(serializer.serializeToString(parseXml(originalXml) as never));
    });
  });

  test('an inserted paragraph does not disturb restoration of its neighbors', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let originalXml = '';
    let savedXml = '';

    await given('a normalized session', async () => {
      ({ doc, originalXml } = await openLikeASession(P1 + P2 + P3));
    });

    await when('a paragraph is inserted and the document is saved minimally', async () => {
      const body = doc.getParagraphs()[0]!.parentNode!;
      const inserted = parseXml(
        `<w:p xmlns:w="${OOXML.W_NS}"><w:r><w:t>brand new</w:t></w:r></w:p>`,
      ).documentElement!;
      body.insertBefore(doc.getParagraphs()[0]!.ownerDocument!.importNode(inserted, true), doc.getParagraphs()[1]!);
      const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
      savedXml = (await readZipText(saved.buffer, 'word/document.xml'))!;
    });

    await then('untouched blocks are restored around the insertion', () => {
      const original = bodyBlocks(originalXml);
      const saved = bodyBlocks(savedXml);
      expect(saved).toHaveLength(original.length + 1);
      expect(saved[0]).toBe(original[0]);
      expect(saved[1]).toContain('brand new');
      expect(saved[2]).toBe(original[1]);
      expect(saved[3]).toBe(original[2]);
      expect(saved[4]).toBe(original[3]);
    });
  });

  test('duplicate-normalizing paragraphs realign to their own originals when the earlier one is edited', async ({ given, when, then }: AllureBddContext) => {
    // Two paragraphs that normalize to IDENTICAL serializations (no paraId,
    // same shape, different run-level rsids). A serialization-keyed FIFO
    // would hand the untouched SECOND paragraph the FIRST's original.
    const originalXmlText =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${OOXML.W_NS}"><w:body>` +
      `<w:p><w:r w:rsidR="00000001"><w:t>same</w:t></w:r></w:p>` +
      `<w:p><w:r w:rsidR="00000002"><w:t>same</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    let currentDoc: Document;
    let restored = 0;

    await given('a session DOM where the first duplicate was edited', () => {
      currentDoc = parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${OOXML.W_NS}"><w:body>` +
        `<w:p><w:r><w:t>changed</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>same</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
      );
    });

    await when('untouched blocks are restored', () => {
      restored = restoreUntouchedBlocks(currentDoc, originalXmlText);
    });

    await then('the untouched second paragraph regains its own rsid identity', () => {
      const blocks = bodyBlocks(serializer.serializeToString(currentDoc as never));
      expect(restored).toBe(1);
      expect(blocks[0]).toContain('changed');
      expect(blocks[0]).not.toContain('rsidR');
      expect(blocks[1]).toContain('w:rsidR="00000002"');
    });
  });

  test('an untouched hyperlink paragraph restores when tracked output groups link text into one run', async ({ given, when, then }: AllureBddContext) => {
    const originalXmlText =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}"><w:body>` +
      `<w:p w14:paraId="56317D3A" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w:rsidR="00AA00AA">` +
      `<w:proofErr w:type="spellStart"/>` +
      `<w:r w:rsidR="00AA00AA"><w:t>Untouched</w:t></w:r>` +
      `<w:hyperlink r:id="rIdHyperlink">` +
      `<w:r w:rsidR="00AA0001"><w:t>commonpaper.com/standards/mutual-</w:t></w:r>` +
      `<w:r w:rsidR="00AA0002"><w:t>nda</w:t></w:r>` +
      `<w:r w:rsidR="00AA0003"><w:t>/1.0</w:t></w:r>` +
      `</w:hyperlink>` +
      `<w:r w:rsidR="00BB00BB"><w:t xml:space="preserve"> paragraph</w:t></w:r>` +
      `<w:proofErr w:type="spellEnd"/>` +
      `</w:p>` +
      `</w:body></w:document>`;
    let currentDoc: Document;
    let restored = 0;

    await given('a tracked-save paragraph reconstructed with one hyperlink run and multiple text nodes', () => {
      currentDoc = parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}"><w:body>` +
          `<w:p w14:paraId="56317D3A" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w:rsidR="00AA00AA">` +
          `<w:r><w:t>Untouched</w:t></w:r>` +
          `<w:hyperlink r:id="rIdHyperlink">` +
          `<w:r><w:t>commonpaper.com/standards/mutual-</w:t><w:t>nda</w:t><w:t>/1.0</w:t></w:r>` +
          `</w:hyperlink>` +
          `<w:r><w:t xml:space="preserve"> paragraph</w:t></w:r>` +
          `</w:p>` +
          `</w:body></w:document>`,
      );
    });

    await when('untouched blocks are restored', () => {
      restored = restoreUntouchedBlocks(currentDoc, originalXmlText);
    });

    await then('the original hyperlink paragraph is restored with proofing markers and run boundaries', () => {
      const [original] = bodyBlocks(originalXmlText);
      const [current] = bodyBlocks(serializer.serializeToString(currentDoc as never));
      expect(restored).toBe(1);
      expect(current).toBe(original);
      expect(current).toContain('<w:proofErr w:type="spellStart"/>');
      expect(current).toContain('<w:r w:rsidR="00AA0002"><w:t>nda</w:t></w:r>');
    });
  });

  test('an untouched table restores while a modified table keeps its edit', async ({ given, when, then }: AllureBddContext) => {
    const CELL_P =
      `<w:p><w:proofErr w:type="spellStart"/><w:r w:rsidR="00CC0001"><w:t>cell</w:t></w:r>` +
      `<w:proofErr w:type="spellEnd"/><w:r w:rsidR="00CC0002"><w:t xml:space="preserve"> text</w:t></w:r></w:p>`;
    const TBL = (cellP: string) =>
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>${cellP}</w:tc></w:tr></w:tbl>`;
    let untouched: { originalXml: string; savedXml: string };
    let modified: { originalXml: string; savedXml: string };

    await given('two sessions over a document containing a table', async () => {
      untouched = { originalXml: '', savedXml: '' };
      modified = { originalXml: '', savedXml: '' };
    });

    await when('one session edits a paragraph outside the table, the other a cell inside it', async () => {
      {
        const { doc, originalXml } = await openLikeASession(TBL(CELL_P) + P2);
        const outside = doc.getParagraphs().find((p) => firstTextNode(p).textContent === '{placeholder}')!;
        firstTextNode(outside).textContent = 'edited outside';
        const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
        untouched = { originalXml, savedXml: (await readZipText(saved.buffer, 'word/document.xml'))! };
      }
      {
        const { doc, originalXml } = await openLikeASession(TBL(CELL_P) + P2);
        const inside = doc.getParagraphs().find((p) => firstTextNode(p).textContent?.startsWith('cell'))!;
        firstTextNode(inside).textContent = 'edited inside';
        const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
        modified = { originalXml, savedXml: (await readZipText(saved.buffer, 'word/document.xml'))! };
      }
    });

    await then('the untouched table is element-identical and the edited table is not reverted', () => {
      const untouchedOriginal = bodyBlocks(untouched.originalXml);
      const untouchedSaved = bodyBlocks(untouched.savedXml);
      expect(untouchedSaved[0]).toBe(untouchedOriginal[0]);
      expect(untouchedSaved[0]).toContain('proofErr');
      expect(untouchedSaved[1]).toContain('edited outside');

      const modifiedSaved = bodyBlocks(modified.savedXml);
      const modifiedOriginal = bodyBlocks(modified.originalXml);
      expect(modifiedSaved[0]).toContain('edited inside');
      expect(modifiedSaved[0]).not.toBe(modifiedOriginal[0]);
      // The paragraph outside the table is untouched in this session.
      expect(modifiedSaved[1]).toBe(modifiedOriginal[1]);
    });
  });

  test('untouched paragraphs inside an edited table are restored individually', async ({ given, when, then }: AllureBddContext) => {
    // Two rows; the edit touches one paragraph in one cell. Every other
    // proofErr/rsid-bearing paragraph in the table must keep its original
    // XML — issue #408's repro document is almost entirely tables.
    const cellP = (id: string, marker: string) =>
      `<w:p w14:paraId="${id}"><w:proofErr w:type="spellStart"/><w:r w:rsidR="0000${marker}01"><w:t>${marker}</w:t></w:r>` +
      `<w:proofErr w:type="spellEnd"/><w:r w:rsidR="0000${marker}02"><w:t xml:space="preserve"> tail</w:t></w:r></w:p>`;
    const tableBody =
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc>${cellP('00000A01', 'AA')}${cellP('00000A02', 'AB')}</w:tc><w:tc>${cellP('00000B01', 'BA')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${cellP('00000C01', 'CA')}</w:tc><w:tc>${cellP('00000D01', 'DA')}</w:tc></w:tr>` +
      `</w:tbl>`;
    let doc: DocxDocument;
    let originalXml = '';
    let savedXml = '';

    await given('a normalized session over a two-row table', async () => {
      ({ doc, originalXml } = await openLikeASession(tableBody + P2));
    });

    await when('one paragraph in one cell is edited and the document saved minimally', async () => {
      const target = doc.getParagraphs().find((p) => firstTextNode(p).textContent?.startsWith('AB'))!;
      firstTextNode(target).textContent = 'edited in cell';
      const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
      savedXml = (await readZipText(saved.buffer, 'word/document.xml'))!;
    });

    await then('only that paragraph differs across the whole document', () => {
      const collectParagraphs = (xml: string) =>
        Array.from(parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, W.p))
          .map((p) => serializer.serializeToString(p as never));
      const original = collectParagraphs(originalXml);
      const saved = collectParagraphs(savedXml);
      expect(saved).toHaveLength(original.length);
      const changed = original
        .map((p, i) => (p === saved[i] ? null : i))
        .filter((i) => i !== null);
      expect(changed).toHaveLength(1);
      expect(saved[changed[0]!]).toContain('edited in cell');
      // Its same-cell sibling kept its proofing markup and rsids.
      expect(saved[0]).toBe(original[0]);
      expect(saved[0]).toContain('proofErr');
    });
  });

  test('falls back to full re-serialization when no original text was captured', async ({ given, when, then }: AllureBddContext) => {
    let restored = -1;
    let savedXml = '';

    await given('a document instance whose original XML cannot be aligned', () => {
      // restoreUntouchedBlocks with an original that has no w:body restores
      // nothing rather than guessing.
    });

    await when('restoration runs against a body-less original', () => {
      const currentDoc = parseXml(
        `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
      );
      restored = restoreUntouchedBlocks(currentDoc, `<w:document xmlns:w="${OOXML.W_NS}"/>`);
      savedXml = serializer.serializeToString(currentDoc as never);
    });

    await then('nothing is restored and the document is left as-is', () => {
      expect(restored).toBe(0);
      expect(savedXml).toContain('<w:t>x</w:t>');
    });
  });
});
