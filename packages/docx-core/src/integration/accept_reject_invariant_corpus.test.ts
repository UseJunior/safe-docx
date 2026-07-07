/**
 * Invariant test corpus for selective accept/reject (#124).
 *
 * A mixed-author corpus: every fixture carries an AI-authored revision, a
 * foreign (reviewer) revision, and one document feature. After acceptAIEdits /
 * rejectAIEdits targeting the AI author the corpus proves, per fixture:
 *   - every AI-authored revision was resolved (0 remain),
 *   - every foreign revision is BYTE-IDENTICAL — the serialized subtrees, by
 *     author, are exactly equal (same set and count) before and after,
 *   - the document feature is preserved,
 *   - field structure stays balanced and the body passes structural lint
 *     (validateDocument).
 *
 * Scope. accept/reject resolves the revision types the engine processes today:
 * `w:ins`, `w:del`, `w:moveFrom`/`w:moveTo`, and the property changes
 * `w:rPrChange`/`w:pPrChange`/`w:sectPrChange`/`w:tblPrChange`/`w:trPrChange`/
 * `w:tcPrChange`. Cell-topology and grid/numbering revisions
 * (`w:cellIns`/`w:cellDel`/`w:cellMerge`/`w:tblGridChange`/`w:numberingChange`)
 * are not resolved by the engine and are not emitted by any current primitive
 * (SUPPORT.md Appendix B), so they are deferred. Parts the sweep never reads —
 * `styles.xml`, `numbering.xml`, headers/footers, relationships, content types —
 * are preserved by construction; the corpus focuses on the swept stories
 * (document.xml + footnotes/endnotes/comments) where preservation is non-trivial.
 *
 * `validateDocument` is body-level structural lint (bookmarks, tracked-change
 * wrapper attributes, field balance), not a substitute for a Word/LibreOffice
 * round-trip. Representative accepted fixtures were additionally opened in
 * LibreOffice headless locally without a recovery prompt (see SUPPORT.md).
 */
import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { itAllure as it } from '../testing/allure-test.js';
import { parseXml, serializeXml } from '../primitives/xml.js';
import { acceptAIEdits, rejectAIEdits } from '../primitives/accept_ai_edits.js';
import { validateDocument } from '../primitives/validate_document.js';
import { TRACKED_CHANGE_ELEMENT_NAME_SET } from '../primitives/revision-vocabulary.js';
import { DocxDocument } from '../primitives/document.js';
import { DocxZip } from '../primitives/zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';
const HUMAN = 'Reviewer';
const DT = 'w:date="2026-01-01T00:00:00Z"';
const SECT = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
const serializer = new XMLSerializer();

function docFromBody(inner: string): Document {
  return parseXml(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${inner}${SECT}</w:body></w:document>`);
}

/** Serialized subtrees of every tracked-change element authored by `author`, sorted. */
function revisionSubtreesByAuthor(root: Document | Element, author: string): string[] {
  const out: string[] = [];
  const all = root.getElementsByTagNameNS(W, '*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (!TRACKED_CHANGE_ELEMENT_NAME_SET.has(el.localName)) continue;
    const a = el.getAttributeNS(W, 'author') ?? el.getAttribute('w:author');
    if (a === author) out.push(serializer.serializeToString(el));
  }
  return out.sort();
}

function aiRevisionCount(root: Document | Element): number {
  return revisionSubtreesByAuthor(root, AI).length;
}

function fieldsBalanced(doc: Document): boolean {
  const chars = Array.from(doc.getElementsByTagNameNS(W, 'fldChar'));
  let depth = 0;
  for (const c of chars) {
    const t = c.getAttributeNS(W, 'fldCharType') ?? c.getAttribute('w:fldCharType');
    if (t === 'begin') depth++;
    else if (t === 'end') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// AI id=101 (ins carrying "ai "), reviewer id=102. Fixtures may add more.
const aiIns = `<w:ins w:id="101" w:author="${AI}" ${DT}><w:r><w:t xml:space="preserve">ai </w:t></w:r></w:ins>`;
const foreignIns = `<w:ins w:id="102" w:author="${HUMAN}" ${DT}><w:r><w:t xml:space="preserve">reviewer</w:t></w:r></w:ins>`;

interface Fixture {
  name: string;
  body: string;
  featureMarkers: string[];
}

const FIXTURES: Fixture[] = [
  {
    name: 'comment range markers',
    body:
      `<w:p><w:commentRangeStart w:id="5"/><w:r><w:t>anchored</w:t></w:r>` +
      `<w:commentRangeEnd w:id="5"/><w:r><w:commentReference w:id="5"/></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['<w:commentRangeStart w:id="5"/>', '<w:commentRangeEnd w:id="5"/>', 'w:commentReference w:id="5"'],
  },
  {
    name: 'internal and user bookmarks',
    body:
      `<w:bookmarkStart w:id="1" w:name="_bk_abc123"/><w:bookmarkStart w:id="2" w:name="UserBookmark"/>` +
      `<w:p><w:r><w:t>text</w:t></w:r>${aiIns}${foreignIns}</w:p>` +
      `<w:bookmarkEnd w:id="2"/><w:bookmarkEnd w:id="1"/>`,
    featureMarkers: ['w:name="_bk_abc123"', 'w:name="UserBookmark"', '<w:bookmarkEnd w:id="1"/>', '<w:bookmarkEnd w:id="2"/>'],
  },
  {
    name: 'content control (w:sdt)',
    body:
      `<w:sdt><w:sdtPr><w:alias w:val="Field1"/><w:id w:val="99"/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>controlled</w:t></w:r>${aiIns}${foreignIns}</w:p></w:sdtContent></w:sdt>`,
    featureMarkers: ['<w:sdt>', '<w:alias w:val="Field1"/>', '<w:sdtContent>'],
  },
  {
    name: 'field codes (PAGE)',
    body:
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['w:fldCharType="begin"', 'w:fldCharType="end"', ' PAGE '],
  },
  {
    name: 'numbering reference (numPr)',
    body:
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
      `<w:r><w:t>item</w:t></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['<w:numPr>', '<w:numId w:val="3"/>'],
  },
  {
    name: 'styled paragraph (pStyle)',
    body:
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
      `<w:r><w:t>heading</w:t></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['<w:pStyle w:val="Heading1"/>'],
  },
  {
    name: 'foreign property change beside AI insertion',
    body:
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="102" w:author="${HUMAN}" ${DT}><w:rPr/></w:rPrChange></w:rPr>` +
      `<w:t>styled</w:t></w:r>${aiIns}</w:p>`,
    featureMarkers: ['<w:b/>'],
  },
  {
    name: 'foreign section-properties change beside AI insertion',
    body:
      `<w:p>${aiIns}</w:p>` +
      `<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="102" w:author="${HUMAN}" ${DT}><w:sectPr/></w:sectPrChange></w:sectPr></w:pPr></w:p>`,
    featureMarkers: ['<w:sectPr>'],
  },
  {
    name: 'table cell-property change (foreign) beside AI insertion',
    body:
      `<w:tbl><w:tr><w:tc><w:tcPr>` +
      `<w:tcPrChange w:id="102" w:author="${HUMAN}" ${DT}><w:tcPr/></w:tcPrChange></w:tcPr>` +
      `<w:p><w:r><w:t>cell</w:t></w:r>${aiIns}</w:p></w:tc></w:tr></w:tbl>`,
    featureMarkers: ['<w:tbl>', '<w:tc>', '<w:tcPr>'],
  },
];

describe('accept/reject invariant corpus (#124)', () => {
  for (const fx of FIXTURES) {
    it(`accept resolves AI + preserves foreign & feature — "${fx.name}"`, () => {
      const doc = docFromBody(fx.body);
      const foreignBefore = revisionSubtreesByAuthor(doc, HUMAN);
      expect(aiRevisionCount(doc), 'fixture must start with an AI revision').toBeGreaterThan(0);
      expect(foreignBefore.length, 'fixture must start with a foreign revision').toBeGreaterThan(0);

      acceptAIEdits(doc, { author: AI });
      const out = serializeXml(doc);

      // Every AI revision resolved; foreign revisions byte-identical (set + count).
      expect(aiRevisionCount(doc)).toBe(0);
      expect(revisionSubtreesByAuthor(doc, HUMAN)).toEqual(foreignBefore);
      // Accepted AI-inserted text is retained (when the fixture inserted text).
      if (fx.body.includes('>ai <')) expect(out).toContain('ai ');
      for (const marker of fx.featureMarkers) expect(out, `${fx.name}: ${marker}`).toContain(marker);
      expect(fieldsBalanced(doc)).toBe(true);
      expect(validateDocument(doc).isValid).toBe(true);
    });

    it(`reject reverts AI + preserves foreign & feature — "${fx.name}"`, () => {
      const doc = docFromBody(fx.body);
      const foreignBefore = revisionSubtreesByAuthor(doc, HUMAN);

      rejectAIEdits(doc, { author: AI });
      const out = serializeXml(doc);

      expect(aiRevisionCount(doc)).toBe(0);
      expect(revisionSubtreesByAuthor(doc, HUMAN)).toEqual(foreignBefore);
      // Rejected AI-inserted text is removed.
      if (fx.body.includes('>ai <')) expect(out).not.toContain('ai ');
      for (const marker of fx.featureMarkers) expect(out, `${fx.name}: ${marker}`).toContain(marker);
      expect(fieldsBalanced(doc)).toBe(true);
      expect(validateDocument(doc).isValid).toBe(true);
    });
  }

  it('exercises ins + del + property-change resolution in one mixed-author document', () => {
    const body =
      `<w:p>${aiIns}${foreignIns}` +
      `<w:del w:id="103" w:author="${AI}" ${DT}><w:r><w:delText>d</w:delText></w:r></w:del>` +
      `<w:del w:id="104" w:author="${HUMAN}" ${DT}><w:r><w:delText>keep</w:delText></w:r></w:del>` +
      `<w:r><w:rPr><w:i/><w:rPrChange w:id="105" w:author="${AI}" ${DT}><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r></w:p>`;

    const acc = docFromBody(body);
    const foreignBeforeAcc = revisionSubtreesByAuthor(acc, HUMAN);
    const a = acceptAIEdits(acc, { author: AI });
    expect(a.result.insertionsAccepted).toBe(1);
    expect(a.result.deletionsAccepted).toBe(1);
    expect(a.result.propertyChangesResolved).toBe(1);
    expect(a.selectedIds.sort()).toEqual(['101', '103', '105']);
    expect(aiRevisionCount(acc)).toBe(0);
    expect(revisionSubtreesByAuthor(acc, HUMAN)).toEqual(foreignBeforeAcc);
    expect(validateDocument(acc).isValid).toBe(true);

    const rej = docFromBody(body);
    const foreignBeforeRej = revisionSubtreesByAuthor(rej, HUMAN);
    const r = rejectAIEdits(rej, { author: AI });
    expect(r.result.insertionsRemoved).toBe(1);
    expect(r.result.deletionsRestored).toBe(1);
    expect(r.result.propertyChangesReverted).toBe(1);
    expect(aiRevisionCount(rej)).toBe(0);
    expect(revisionSubtreesByAuthor(rej, HUMAN)).toEqual(foreignBeforeRej);
    expect(validateDocument(rej).isValid).toBe(true);
  });

  // ── Side-story parts: footnotes and endnotes (facade sweep) ──────────────

  /** Build a minimal, valid DOCX with a registered side-story part. */
  async function buildDocxWithSidePart(bodyInner: string, partPath: string, partXml: string): Promise<Buffer> {
    const rel = partPath.replace('word/', '');
    const relType = rel.startsWith('footnotes')
      ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'
      : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
    const ctOverride = rel.startsWith('footnotes')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
    const files: Record<string, string> = {
      '[Content_Types].xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/${partPath}" ContentType="${ctOverride}"/></Types>`,
      '_rels/.rels':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/_rels/document.xml.rels':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId10" Type="${relType}" Target="${rel}"/></Relationships>`,
      'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${bodyInner}${SECT}</w:body></w:document>`,
      [partPath]: partXml,
    };
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const [p, c] of Object.entries(files)) zip.file(p, c);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  const footnoteFixture = (label: string, id: number) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:${label}s xmlns:w="${W}">` +
    `<w:${label} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${label}>` +
    `<w:${label} w:id="${id}"><w:p><w:r><w:t>note </w:t></w:r>${foreignIns}${aiIns}</w:p></w:${label}>` +
    `</w:${label}s>`;

  for (const [label, part, refLocal] of [
    ['footnote', 'word/footnotes.xml', 'footnoteReference'],
    ['endnote', 'word/endnotes.xml', 'endnoteReference'],
  ] as const) {
    for (const op of ['accept', 'reject'] as const) {
      it(`${op} sweeps ${label}s and preserves a reviewer revision inside the note`, async () => {
        const bodyInner =
          `<w:p><w:r><w:t>body</w:t></w:r>` +
          `<w:r><w:rPr><w:rStyle w:val="${label === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr>` +
          `<w:${refLocal} w:id="9"/></w:r></w:p>`;
        const partXml = footnoteFixture(label, 9);
        const foreignBefore = revisionSubtreesByAuthor(parseXml(partXml), HUMAN);
        expect(foreignBefore.length).toBe(1);

        const doc = await DocxDocument.load(await buildDocxWithSidePart(bodyInner, part, partXml));
        if (op === 'accept') await doc.acceptAIEdits({ author: AI });
        else await doc.rejectAIEdits({ author: AI });

        const outZip = await DocxZip.load((await doc.toBuffer({ cleanBookmarks: false })).buffer);
        const notePart = parseXml(await outZip.readText(part));
        // AI revision in the note resolved; reviewer revision byte-identical.
        expect(aiRevisionCount(notePart)).toBe(0);
        expect(revisionSubtreesByAuthor(notePart, HUMAN)).toEqual(foreignBefore);
        // The note itself and its body reference survive.
        expect(await outZip.readText(part)).toContain(`w:id="9"`);
        expect(await outZip.readText('word/document.xml')).toContain(`w:${refLocal} w:id="9"`);
      });
    }
  }
});
