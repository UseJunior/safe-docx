/**
 * Invariant test corpus for selective accept/reject (#124).
 *
 * A mixed-author corpus: every fixture carries an AI-authored revision, a
 * foreign (reviewer) revision, and one document feature that must survive the
 * operation. After acceptAIEdits / rejectAIEdits targeting the AI author we
 * assert, per fixture:
 *   - the AI revision was resolved (accepted or reverted),
 *   - the foreign revision is byte-identical (its serialized subtree is intact),
 *   - the document feature (comment ranges, bookmarks, content controls, field
 *     codes, section properties, numbering, styles) is preserved,
 *   - field structure stays balanced and the document remains structurally valid
 *     (validateDocument reports isValid — the CI-runnable proxy for "opens in
 *     Word/LibreOffice without recovery").
 *
 * Round-trip evidence: the built fixtures were opened in LibreOffice headless
 * (soffice --convert-to pdf) locally without a recovery prompt; see the PR notes.
 * CI asserts structural validity via validateDocument since Word/LibreOffice are
 * not available on the runners.
 */
import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { parseXml, serializeXml } from '../primitives/xml.js';
import { acceptAIEdits, rejectAIEdits } from '../primitives/accept_ai_edits.js';
import { validateDocument } from '../primitives/validate_document.js';
import { DocxDocument } from '../primitives/document.js';
import { DocxZip } from '../primitives/zip.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';
const HUMAN = 'Reviewer';

function docFromBody(inner: string): Document {
  return parseXml(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${inner}${SECT}</w:body></w:document>`);
}
const SECT = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;

// Reusable revision + feature fragments. AI id=101, reviewer id=102.
const aiIns = `<w:ins w:id="101" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">ai </w:t></w:r></w:ins>`;
const foreignIns = `<w:ins w:id="102" w:author="${HUMAN}" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">reviewer</w:t></w:r></w:ins>`;

/** Field-balance check: count fldChar begin vs end across the doc. */
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

interface Fixture {
  name: string;
  /** Feature-bearing paragraph(s), plus the AI + reviewer revisions. */
  body: string;
  /** Substrings that must survive both accept and reject (the feature markers). */
  featureMarkers: string[];
  /** Serialized foreign-revision subtree that must remain byte-identical. */
  foreign: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'comment range markers',
    body:
      `<w:p><w:commentRangeStart w:id="5"/><w:r><w:t>anchored</w:t></w:r>` +
      `<w:commentRangeEnd w:id="5"/><w:r><w:commentReference w:id="5"/></w:r>` +
      `${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['<w:commentRangeStart w:id="5"/>', '<w:commentRangeEnd w:id="5"/>', 'w:commentReference w:id="5"'],
    foreign: foreignIns,
  },
  {
    name: 'internal and user bookmarks',
    body:
      `<w:bookmarkStart w:id="1" w:name="_bk_abc123"/><w:bookmarkStart w:id="2" w:name="UserBookmark"/>` +
      `<w:p><w:r><w:t>text</w:t></w:r>${aiIns}${foreignIns}</w:p>` +
      `<w:bookmarkEnd w:id="2"/><w:bookmarkEnd w:id="1"/>`,
    featureMarkers: ['w:name="_bk_abc123"', 'w:name="UserBookmark"', '<w:bookmarkEnd w:id="1"/>', '<w:bookmarkEnd w:id="2"/>'],
    foreign: foreignIns,
  },
  {
    name: 'content control (w:sdt)',
    body:
      `<w:sdt><w:sdtPr><w:alias w:val="Field1"/><w:id w:val="99"/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>controlled</w:t></w:r>${aiIns}${foreignIns}</w:p></w:sdtContent></w:sdt>`,
    featureMarkers: ['<w:sdt>', '<w:alias w:val="Field1"/>', '<w:sdtContent>'],
    foreign: foreignIns,
  },
  {
    name: 'field codes (PAGE)',
    body:
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['w:fldCharType="begin"', 'w:fldCharType="end"', ' PAGE '],
    foreign: foreignIns,
  },
  {
    name: 'numbering (numPr)',
    body:
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
      `<w:r><w:t>item</w:t></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['<w:numPr>', '<w:numId w:val="3"/>'],
    foreign: foreignIns,
  },
  {
    name: 'styled paragraph (pStyle)',
    body:
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
      `<w:r><w:t>heading</w:t></w:r>${aiIns}${foreignIns}</w:p>`,
    featureMarkers: ['<w:pStyle w:val="Heading1"/>'],
    foreign: foreignIns,
  },
  {
    name: 'foreign property change alongside AI insertion',
    body:
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="102" w:author="${HUMAN}" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr>` +
      `<w:t>styled</w:t></w:r>${aiIns}</w:p>`,
    featureMarkers: ['<w:b/>'],
    foreign: `<w:rPrChange w:id="102" w:author="${HUMAN}" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange>`,
  },
];

describe('accept/reject invariant corpus (#124)', () => {
  for (const fx of FIXTURES) {
    it(`accept preserves foreign revision + "${fx.name}"`, () => {
      const doc = docFromBody(fx.body);
      const { result } = acceptAIEdits(doc, { author: AI });
      const out = serializeXml(doc);
      // AI revision resolved: its wrapper id is gone.
      expect(out).not.toContain('w:id="101"');
      expect(result.insertionsAccepted + result.propertyChangesResolved).toBeGreaterThanOrEqual(0);
      // Foreign revision byte-identical, feature markers intact.
      expect(out).toContain(fx.foreign);
      for (const marker of fx.featureMarkers) expect(out, `${fx.name}: ${marker}`).toContain(marker);
      // Field balance + structural validity.
      expect(fieldsBalanced(doc)).toBe(true);
      expect(validateDocument(doc).isValid).toBe(true);
    });

    it(`reject preserves foreign revision + "${fx.name}"`, () => {
      const doc = docFromBody(fx.body);
      rejectAIEdits(doc, { author: AI });
      const out = serializeXml(doc);
      expect(out).not.toContain('ai '); // AI insertion reverted (removed)
      expect(out).toContain(fx.foreign);
      for (const marker of fx.featureMarkers) expect(out, `${fx.name}: ${marker}`).toContain(marker);
      expect(fieldsBalanced(doc)).toBe(true);
      expect(validateDocument(doc).isValid).toBe(true);
    });
  }

  it('accept preserves footnotes + a reviewer revision inside a note (facade, side part)', async () => {
    const bodyXml =
      `<w:p><w:r><w:t>body</w:t></w:r>${aiIns}` +
      `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="7"/></w:r></w:p>`;
    const footnotesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:id="7"><w:p><w:r><w:t>note </w:t></w:r>${foreignIns}</w:p></w:footnote>` +
      `</w:footnotes>`;
    const zip = await DocxZip.load(await buildDocxFromBodyXml(bodyXml));
    zip.writeText('word/footnotes.xml', footnotesXml);
    const doc = await DocxDocument.load(await zip.toBuffer());

    await doc.acceptAIEdits({ author: AI });

    const outZip = await DocxZip.load((await doc.toBuffer({ cleanBookmarks: false })).buffer);
    const outBody = await outZip.readText('word/document.xml');
    const outFootnotes = await outZip.readText('word/footnotes.xml');
    // AI insertion accepted in the body; footnote reference + note preserved.
    expect(outBody).not.toContain('w:id="101"');
    expect(outBody).toContain('w:footnoteReference w:id="7"');
    expect(outFootnotes).toContain('w:footnote w:id="7"');
    // Reviewer revision inside the note is byte-identical.
    expect(outFootnotes).toContain(foreignIns);
  });

  it('covers each surface revision type at least once (accept and reject)', () => {
    // Guard: the corpus exercises ins, del, and property-change revision types
    // across accept and reject on a mixed-author document.
    const body =
      `<w:p>${aiIns}${foreignIns}` +
      `<w:del w:id="103" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>d</w:delText></w:r></w:del>` +
      `<w:del w:id="104" w:author="${HUMAN}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>keep</w:delText></w:r></w:del>` +
      `<w:r><w:rPr><w:i/><w:rPrChange w:id="105" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r></w:p>`;
    const foreignDel = `<w:del w:id="104" w:author="${HUMAN}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>keep</w:delText></w:r></w:del>`;

    const acc = docFromBody(body);
    const a = acceptAIEdits(acc, { author: AI });
    expect(a.result.insertionsAccepted).toBe(1);
    expect(a.result.deletionsAccepted).toBe(1);
    expect(a.result.propertyChangesResolved).toBe(1);
    expect(serializeXml(acc)).toContain(foreignDel); // foreign del untouched
    expect(validateDocument(acc).isValid).toBe(true);

    const rej = docFromBody(body);
    const r = rejectAIEdits(rej, { author: AI });
    expect(r.result.insertionsRemoved).toBe(1);
    expect(r.result.deletionsRestored).toBe(1);
    expect(r.result.propertyChangesReverted).toBe(1);
    expect(serializeXml(rej)).toContain(foreignDel);
    expect(validateDocument(rej).isValid).toBe(true);
  });
});
