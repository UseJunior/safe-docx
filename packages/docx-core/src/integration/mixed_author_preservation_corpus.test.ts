/**
 * Mixed-author preservation corpus (#125).
 *
 * The headline correctness property of the tracked-changes-as-canonical design:
 *
 *   > After acceptAIEdits(doc) in normalized non-overlap mode, every tracked-change
 *   > element whose w:id or w:author is not the AI actor is byte-identical
 *   > (modulo namespace/whitespace normalization) to its pre-acceptance form.
 *
 * This corpus is deliberately isolated from the broader invariant corpus (#124)
 * to give the most failure-prone property a sharp pass/fail signal. Fixtures
 * interleave THREE actors — the AI, a human reviewer, and a third-party reviewer —
 * across body text, tables, headers/footers, and footnotes/endnotes, and assert
 * that resolving one actor leaves BOTH other actors' revisions byte-identical.
 * A dedicated ambiguous-overlap fixture exercises the #123 hard-error path.
 */
import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { itAllure as it } from '../testing/allure-test.js';
import { parseXml } from '../primitives/xml.js';
import { AmbiguousRevisionOverlapError } from '../primitives/accept_ai_edits.js';
import { TRACKED_CHANGE_ELEMENT_NAME_SET } from '../primitives/revision-vocabulary.js';
import { DocxDocument } from '../primitives/document.js';
import { DocxZip } from '../primitives/zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const AI = 'SafeDocX AI';
const HUMAN = 'Reviewer';
const THIRD = 'Third Party';
const DT = 'w:date="2026-01-01T00:00:00Z"';
const SECT = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
const serializer = new XMLSerializer();

/** Ancestor local-name path from the story root down to `el`. */
function ancestorPath(el: Element): string {
  const names: string[] = [];
  let cur: Node | null = el;
  while (cur && cur.nodeType === 1) {
    names.unshift((cur as Element).localName);
    cur = cur.parentNode;
  }
  return names.join('/');
}

/**
 * Context-aware oracle for every tracked-change element authored by `author`:
 * each entry pairs the element's ancestor path (its structural location) with its
 * serialized subtree, sorted. Comparing this before/after proves a foreign
 * revision is neither mutated NOR moved to a different location in the story.
 */
function revisionContextsByAuthor(root: Document | Element, author: string): string[] {
  const out: string[] = [];
  const all = root.getElementsByTagNameNS(W, '*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (!TRACKED_CHANGE_ELEMENT_NAME_SET.has(el.localName)) continue;
    const a = el.getAttributeNS(W, 'author') ?? el.getAttribute('w:author');
    if (a === author) out.push(`${ancestorPath(el)}\n${serializer.serializeToString(el)}`);
  }
  return out.sort();
}

function ins(id: number, author: string, text: string): string {
  return `<w:ins w:id="${id}" w:author="${author}" ${DT}><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
}
function del(id: number, author: string, text: string): string {
  return `<w:del w:id="${id}" w:author="${author}" ${DT}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
}

interface Part {
  path: string;
  xml: string;
  relType: string;
  ctType: string;
  relId: string;
}

/** Build a minimal, valid DOCX with the given extra parts registered. */
async function buildDocx(bodyInner: string, parts: Part[] = []): Promise<Buffer> {
  const overrides = parts
    .map((p) => `<Override PartName="/${p.path}" ContentType="${p.ctType}"/>`)
    .join('');
  const docRels = parts
    .map((p) => `<Relationship Id="${p.relId}" Type="${p.relType}" Target="${p.path.replace('word/', '')}"/>`)
    .join('');
  const files: Record<string, string> = {
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      overrides +
      `</Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels}</Relationships>`,
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyInner}</w:body></w:document>`,
  };
  for (const p of parts) files[p.path] = p.xml;
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function readPart(doc: DocxDocument, path: string): Promise<string> {
  const zip = await DocxZip.load((await doc.toBuffer({ cleanBookmarks: false })).buffer);
  return zip.readText(path);
}

describe('mixed-author preservation corpus (#125)', () => {
  it('accept AI in body leaves both human and third-party revisions byte-identical', async () => {
    const bodyInner =
      `<w:p><w:r><w:t>base </w:t></w:r>` +
      ins(101, AI, 'ai ') + ins(102, HUMAN, 'human ') + del(103, THIRD, 'third') + `</w:p>${SECT}`;
    const doc = await DocxDocument.load(await buildDocx(bodyInner));
    const before = parseXml(await readPart(doc, 'word/document.xml'));
    const humanBefore = revisionContextsByAuthor(before, HUMAN);
    const thirdBefore = revisionContextsByAuthor(before, THIRD);

    await doc.acceptAIEdits({ author: AI });

    const after = parseXml(await readPart(doc, 'word/document.xml'));
    expect(revisionContextsByAuthor(after, AI)).toEqual([]); // AI resolved
    expect(revisionContextsByAuthor(after, HUMAN)).toEqual(humanBefore); // byte-identical
    expect(revisionContextsByAuthor(after, THIRD)).toEqual(thirdBefore);
  });

  it('reject AI in body leaves both human and third-party revisions byte-identical', async () => {
    const bodyInner =
      `<w:p><w:r><w:t>base </w:t></w:r>` +
      ins(101, AI, 'ai ') + ins(102, HUMAN, 'human ') + del(103, THIRD, 'third') + `</w:p>${SECT}`;
    const doc = await DocxDocument.load(await buildDocx(bodyInner));
    const before = parseXml(await readPart(doc, 'word/document.xml'));
    const humanBefore = revisionContextsByAuthor(before, HUMAN);
    const thirdBefore = revisionContextsByAuthor(before, THIRD);

    await doc.rejectAIEdits({ author: AI });

    const after = parseXml(await readPart(doc, 'word/document.xml'));
    expect(revisionContextsByAuthor(after, AI)).toEqual([]);
    expect(revisionContextsByAuthor(after, HUMAN)).toEqual(humanBefore);
    expect(revisionContextsByAuthor(after, THIRD)).toEqual(thirdBefore);
  });

  it('selecting a non-AI author resolves only that author, leaving AI and third-party intact', async () => {
    const bodyInner =
      `<w:p><w:r><w:t>base </w:t></w:r>` +
      ins(101, AI, 'ai ') + ins(102, HUMAN, 'human ') + ins(103, THIRD, 'third') + `</w:p>${SECT}`;
    const doc = await DocxDocument.load(await buildDocx(bodyInner));
    const before = parseXml(await readPart(doc, 'word/document.xml'));
    const aiBefore = revisionContextsByAuthor(before, AI);
    const thirdBefore = revisionContextsByAuthor(before, THIRD);

    // Accept the HUMAN reviewer's revisions, not the AI's.
    const { selectedIds } = await doc.acceptAIEdits({ author: HUMAN });
    expect(selectedIds).toEqual(['102']);

    const after = parseXml(await readPart(doc, 'word/document.xml'));
    expect(revisionContextsByAuthor(after, HUMAN)).toEqual([]); // human resolved
    expect(revisionContextsByAuthor(after, AI)).toEqual(aiBefore); // AI byte-identical
    expect(revisionContextsByAuthor(after, THIRD)).toEqual(thirdBefore);
  });

  it('accept AI in a table leaves foreign row/cell property changes byte-identical', async () => {
    const bodyInner =
      `<w:tbl>` +
      `<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
      `<w:tr><w:trPr><w:trPrChange w:id="102" w:author="${HUMAN}" ${DT}><w:trPr/></w:trPrChange></w:trPr>` +
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcPrChange w:id="103" w:author="${THIRD}" ${DT}><w:tcPr/></w:tcPrChange></w:tcPr>` +
      `<w:p><w:r><w:t>cell </w:t></w:r>${ins(101, AI, 'ai')}</w:p></w:tc></w:tr></w:tbl>${SECT}`;
    const doc = await DocxDocument.load(await buildDocx(bodyInner));
    const before = parseXml(await readPart(doc, 'word/document.xml'));
    const humanBefore = revisionContextsByAuthor(before, HUMAN);
    const thirdBefore = revisionContextsByAuthor(before, THIRD);

    await doc.acceptAIEdits({ author: AI });

    const afterXml = await readPart(doc, 'word/document.xml');
    const after = parseXml(afterXml);
    expect(revisionContextsByAuthor(after, AI)).toEqual([]);
    expect(revisionContextsByAuthor(after, HUMAN)).toEqual(humanBefore);
    expect(revisionContextsByAuthor(after, THIRD)).toEqual(thirdBefore);
    expect(afterXml).toContain('<w:tbl>'); // table structure preserved
  });

  it('leaves headers and footers entirely untouched (unswept-part guard, incl. AI revisions)', async () => {
    // Headers/footers are NOT in the swept story set, so accept/reject never opens
    // them. Even an AI-authored revision in a header is left untouched — the corpus
    // pins that accept/reject never reaches into these parts for any actor.
    const headerXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>H </w:t></w:r>${ins(201, AI, 'hdr-ai')}${ins(202, HUMAN, 'hdr-rev')}</w:p></w:hdr>`;
    const footerXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>F </w:t></w:r>${del(203, THIRD, 'ftr-rev')}</w:p></w:ftr>`;
    const parts: Part[] = [
      {
        path: 'word/header1.xml', xml: headerXml, relId: 'rId10',
        relType: `${R}/header`,
        ctType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      },
      {
        path: 'word/footer1.xml', xml: footerXml, relId: 'rId11',
        relType: `${R}/footer`,
        ctType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
      },
    ];
    const bodyInner =
      `<w:p><w:r><w:t>body </w:t></w:r>${ins(101, AI, 'ai')}</w:p>` +
      `<w:sectPr><w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
    const doc = await DocxDocument.load(await buildDocx(bodyInner, parts));

    await doc.acceptAIEdits({ author: AI });

    // Whole parts byte-identical — including the AI revision in the header.
    expect(await readPart(doc, 'word/header1.xml')).toBe(headerXml);
    expect(await readPart(doc, 'word/footer1.xml')).toBe(footerXml);
    // The AI revision in the BODY was resolved (only the unswept parts are exempt).
    expect(revisionContextsByAuthor(parseXml(await readPart(doc, 'word/document.xml')), AI)).toEqual([]);
  });

  it('accept AI across footnotes and endnotes preserves human and third-party note revisions', async () => {
    const notePart = (label: string) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:${label}s xmlns:w="${W}">` +
      `<w:${label} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${label}>` +
      `<w:${label} w:id="9"><w:p><w:r><w:t>note </w:t></w:r>` +
      ins(301, AI, 'ai ') + ins(302, HUMAN, 'human ') + del(303, THIRD, 'third') +
      `</w:p></w:${label}></w:${label}s>`;
    const parts: Part[] = [
      {
        path: 'word/footnotes.xml', xml: notePart('footnote'), relId: 'rId20',
        relType: `${R}/footnotes`,
        ctType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
      },
      {
        path: 'word/endnotes.xml', xml: notePart('endnote'), relId: 'rId21',
        relType: `${R}/endnotes`,
        ctType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
      },
    ];
    const doc = await DocxDocument.load(await buildDocx(`<w:p><w:r><w:t>body</w:t></w:r></w:p>${SECT}`, parts));

    await doc.acceptAIEdits({ author: AI });

    for (const [label, part] of [['footnote', 'word/footnotes.xml'], ['endnote', 'word/endnotes.xml']] as const) {
      const before = parseXml(notePart(label));
      const after = parseXml(await readPart(doc, part));
      expect(revisionContextsByAuthor(after, AI), part).toEqual([]); // AI resolved in the note
      expect(revisionContextsByAuthor(after, HUMAN), part).toEqual(revisionContextsByAuthor(before, HUMAN));
      expect(revisionContextsByAuthor(after, THIRD), part).toEqual(revisionContextsByAuthor(before, THIRD));
    }
  });

  it('an AI revision structurally containing a human revision hard-errors with the offending pair', async () => {
    const bodyInner =
      `<w:p><w:ins w:id="101" w:author="${AI}" ${DT}>` +
      `<w:del w:id="102" w:author="${HUMAN}" ${DT}><w:r><w:delText>x</w:delText></w:r></w:del>` +
      `</w:ins></w:p>${SECT}`;
    const doc = await DocxDocument.load(await buildDocx(bodyInner));
    const before = await readPart(doc, 'word/document.xml');

    let error: unknown;
    try {
      await doc.acceptAIEdits({ author: AI });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AmbiguousRevisionOverlapError);
    const overlaps = (error as AmbiguousRevisionOverlapError).overlaps;
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ outerId: '101', outerAuthor: AI, innerId: '102', innerAuthor: HUMAN });

    // The document must be byte-identical after a hard error — no partial mutation.
    expect(await readPart(doc, 'word/document.xml')).toBe(before);
  });
});
