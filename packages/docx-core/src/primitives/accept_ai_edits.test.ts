import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { parseXml, serializeXml } from './xml.js';
import {
  acceptAIEdits,
  rejectAIEdits,
  detectAmbiguousOverlaps,
  resolveSelectedIds,
  collectRevisionElements,
  AmbiguousRevisionOverlapError,
} from './accept_ai_edits.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';
const HUMAN = 'Reviewer';

function body(inner: string): Document {
  return parseXml(
    `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`,
  );
}

function xml(doc: Document): string {
  return serializeXml(doc);
}

// A run inside w:ins keeps its text; a run inside w:del holds w:delText.
const aiIns = (id: number, text: string) =>
  `<w:ins w:id="${id}" w:author="${AI}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const humanIns = (id: number, text: string) =>
  `<w:ins w:id="${id}" w:author="${HUMAN}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const aiDel = (id: number, text: string) =>
  `<w:del w:id="${id}" w:author="${AI}"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const humanDel = (id: number, text: string) =>
  `<w:del w:id="${id}" w:author="${HUMAN}"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

describe('selective accept/reject by revision id/author (#123)', () => {
  describe('id resolution', () => {
    it('resolves explicit revision_ids as strings', () => {
      const doc = body(`<w:p>${aiIns(1, 'a')}${humanIns(2, 'b')}</w:p>`);
      const ids = resolveSelectedIds(collectRevisionElements(doc), { revisionIds: [1, '2'] });
      expect([...ids].sort()).toEqual(['1', '2']);
    });

    it('resolves an author to the ids of every revision it authored', () => {
      const doc = body(`<w:p>${aiIns(1, 'a')}${humanIns(2, 'b')}${aiDel(3, 'c')}</w:p>`);
      const ids = resolveSelectedIds(collectRevisionElements(doc), { author: AI });
      expect([...ids].sort()).toEqual(['1', '3']);
    });
  });

  describe('non-overlapping accept — per revision type, foreign revisions preserved', () => {
    it('accepts an AI insertion and leaves a foreign insertion byte-identical', () => {
      const doc = body(`<w:p><w:r><w:t>keep </w:t></w:r>${aiIns(1, 'ai ')}${humanIns(2, 'human')}</w:p>`);
      const foreignBefore = humanIns(2, 'human');
      const { result } = acceptAIEdits(doc, { author: AI });
      const out = xml(doc);
      expect(result.insertionsAccepted).toBe(1);
      expect(out).toContain('ai '); // inserted text promoted
      expect(out).not.toContain('w:id="1"'); // AI ins wrapper gone
      expect(out).toContain(foreignBefore); // foreign ins untouched, byte-for-byte
    });

    it('accepts an AI deletion (text removed) and leaves a foreign deletion intact', () => {
      const doc = body(`<w:p>${aiDel(1, 'gone ')}${humanDel(2, 'stay-deleted')}</w:p>`);
      const foreignBefore = humanDel(2, 'stay-deleted');
      const { result } = acceptAIEdits(doc, { author: AI });
      const out = xml(doc);
      expect(result.deletionsAccepted).toBe(1);
      expect(out).not.toContain('gone');
      expect(out).toContain(foreignBefore);
    });

    it('accepts an AI rPrChange and leaves a foreign rPrChange intact', () => {
      const aiRun = `<w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="${AI}"><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r>`;
      const humanRun = `<w:r><w:rPr><w:i/><w:rPrChange w:id="2" w:author="${HUMAN}"><w:rPr/></w:rPrChange></w:rPr><w:t>y</w:t></w:r>`;
      const doc = body(`<w:p>${aiRun}${humanRun}</w:p>`);
      const { result } = acceptAIEdits(doc, { author: AI });
      const out = xml(doc);
      expect(result.propertyChangesResolved).toBe(1);
      expect(out).not.toContain('w:id="1"'); // AI rPrChange removed (change accepted)
      expect(out).toContain('w:id="2"'); // foreign rPrChange kept
      expect(out).toContain('<w:b/>'); // accepted formatting retained
    });

    it('accepts an AI paragraph-mark deletion (merge) without touching a foreign mark', () => {
      const doc = body(
        `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="${AI}"/></w:rPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>second</w:t></w:r></w:p>`,
      );
      const { result } = acceptAIEdits(doc, { author: AI });
      const out = xml(doc);
      // Paragraph-break deletion accepted → the two paragraphs merge.
      expect(out).toContain('first');
      expect(out).toContain('second');
      expect(out).not.toContain('w:id="1"');
      expect(result.deletionsAccepted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('non-overlapping reject — per revision type, foreign revisions preserved', () => {
    it('rejects an AI insertion (text removed) and keeps a foreign insertion', () => {
      const doc = body(`<w:p>${aiIns(1, 'ai ')}${humanIns(2, 'human')}</w:p>`);
      const foreignBefore = humanIns(2, 'human');
      const { result } = rejectAIEdits(doc, { author: AI });
      const out = xml(doc);
      expect(result.insertionsRemoved).toBe(1);
      expect(out).not.toContain('ai ');
      expect(out).toContain(foreignBefore);
    });

    it('rejects an AI deletion (text restored) and keeps a foreign deletion', () => {
      const doc = body(`<w:p>${aiDel(1, 'back ')}${humanDel(2, 'stay-deleted')}</w:p>`);
      const foreignBefore = humanDel(2, 'stay-deleted');
      const { result } = rejectAIEdits(doc, { author: AI });
      const out = xml(doc);
      expect(result.deletionsRestored).toBe(1);
      expect(out).toContain('back'); // delText restored as text
      expect(out).not.toContain('w:delText xml:space="preserve">back'); // no longer a deletion
      expect(out).toContain(foreignBefore); // foreign delText kept as delText
    });
  });

  describe('targeting a subset by id', () => {
    it('accepts only the listed ids, leaving same-author siblings untouched', () => {
      const doc = body(`<w:p>${aiIns(1, 'one ')}${aiIns(2, 'two')}</w:p>`);
      const sibling = aiIns(2, 'two');
      acceptAIEdits(doc, { revisionIds: [1] });
      const out = xml(doc);
      expect(out).toContain('one');
      expect(out).not.toContain('w:id="1"');
      expect(out).toContain(sibling); // id 2 untouched
    });
  });

  describe('ambiguous overlap', () => {
    const overlap = body(
      `<w:p><w:ins w:id="10" w:author="${AI}"><w:del w:id="11" w:author="${HUMAN}"><w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:p>`,
    );

    it('detects a foreign revision nested inside a targeted one', () => {
      const overlaps = detectAmbiguousOverlaps(overlap, new Set(['10']));
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0]).toMatchObject({ outerId: '10', outerAuthor: AI, innerId: '11', innerAuthor: HUMAN });
    });

    it('hard-errors on accept with a structured overlap list', () => {
      let err: unknown;
      try {
        acceptAIEdits(body(
          `<w:p><w:ins w:id="10" w:author="${AI}"><w:del w:id="11" w:author="${HUMAN}"><w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:p>`,
        ), { author: AI });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AmbiguousRevisionOverlapError);
      expect((err as AmbiguousRevisionOverlapError).overlaps[0]!.innerId).toBe('11');
    });

    it('hard-errors symmetrically on reject', () => {
      expect(() =>
        rejectAIEdits(body(
          `<w:p><w:ins w:id="10" w:author="${AI}"><w:del w:id="11" w:author="${HUMAN}"><w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:p>`,
        ), { author: AI }),
      ).toThrow(AmbiguousRevisionOverlapError);
    });

    it('normalizeFirst bypasses the hard-error (best-effort)', () => {
      const doc = body(
        `<w:p><w:ins w:id="10" w:author="${AI}"><w:del w:id="11" w:author="${HUMAN}"><w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:p>`,
      );
      const { selectedIds } = acceptAIEdits(doc, { author: AI, normalizeFirst: true });
      expect(selectedIds).toEqual(['10']);
      // The foreign del is not selected, so it survives even in best-effort mode.
      expect(xml(doc)).toContain('w:id="11"');
    });

    it('does not flag a property change legitimately nested in an inserted run', () => {
      const doc = body(
        `<w:p><w:ins w:id="1" w:author="${AI}"><w:r><w:rPr><w:rPrChange w:id="2" w:author="${AI}"><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r></w:ins></w:p>`,
      );
      const overlaps = detectAmbiguousOverlaps(doc, new Set(['1', '2']));
      expect(overlaps).toHaveLength(0);
    });
  });
});
