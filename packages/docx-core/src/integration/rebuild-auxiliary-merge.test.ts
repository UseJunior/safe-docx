/**
 * Integration Tests — Rebuild Auxiliary Part Merging (regression for issue #94)
 *
 * Verifies that footnote, endnote, and comment definitions are correctly
 * merged from the *revised* archive when reconstruction runs in rebuild mode
 * (e.g., when the inplace round-trip safety check fails and falls back).
 *
 * Reported in https://github.com/UseJunior/safe-docx/issues/94: the original
 * implementation gated mergeAuxiliaryPartDefinitions to inplace mode only,
 * leaving rebuild output with dangling references when the original lacked
 * an auxiliary part the revised side introduced — Word would refuse to open
 * such files.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { parseXml } from '../primitives/xml.js';

/**
 * Find every element with the given local name and report its immediate-parent
 * tag and the chain of ancestor tags. Used by the marker-position assertions
 * below.
 */
function inspectElements(xml: string, localName: string): Array<{ parent: string; ancestors: string[]; idAttr: string | null }> {
  const doc = parseXml(xml);
  const found: Array<{ parent: string; ancestors: string[]; idAttr: string | null }> = [];
  const all = doc.getElementsByTagName(localName);
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    const parent = (el.parentNode as Element | null)?.tagName ?? '';
    const ancestors: string[] = [];
    let cur: Element | null = el.parentNode as Element | null;
    while (cur) {
      ancestors.push(cur.tagName);
      cur = cur.parentNode as Element | null;
    }
    found.push({ parent, ancestors, idAttr: el.getAttribute('w:id') });
  }
  return found;
}

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Auxiliary Part Merging — Rebuild Mode' });

describe('Rebuild Auxiliary Part Merging (issue #94)', () => {
  describe('Footnote added on revised side', () => {
    test('rebuild output bundles footnotes.xml + OPC metadata', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no footnotes and revised adds one', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'A new footnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('rebuild output is structurally complete (no dangling references)', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        expect(parts.documentXml).toContain('w:footnoteReference');
        expect(parts.documentXml).toContain('w:id="1"');

        expect(parts.footnotesXml).not.toBeNull();
        expect(parts.footnotesXml!).toContain('w:id="1"');
        expect(parts.footnotesXml!).toContain('A new footnote');

        const userFootnoteCount = (parts.footnotesXml!.match(/<w:footnote w:id="1"/g) ?? []).length;
        expect(userFootnoteCount).toBe(1);

        expect(parts.footnotesXml!).toContain('w:type="separator"');
        expect(parts.footnotesXml!).toContain('w:type="continuationSeparator"');

        expect(parts.contentTypesXml!).toContain('word/footnotes.xml');
        expect(parts.contentTypesXml!).toContain(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'
        );

        expect(parts.relsXml!).toContain('footnotes.xml');
        expect(parts.relsXml!).toContain(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'
        );
      });
    });
  });

  describe('Comment added on revised side', () => {
    test('rebuild output bundles comments.xml + OPC metadata', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no comments and revised adds one', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Review needed',
          commentAuthor: 'Reviewer',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('comment anchors survive atomization and comments.xml is bundled', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        expect(parts.documentXml).toContain('w:commentReference');
        expect(parts.documentXml).toContain('w:id="1"');

        expect(parts.commentsXml).not.toBeNull();
        expect(parts.commentsXml!).toContain('w:id="1"');
        expect(parts.commentsXml!).toContain('Review needed');
        expect(parts.commentsXml!).toContain('Reviewer');

        const commentCount = (parts.commentsXml!.match(/<w:comment\b/g) ?? []).length;
        expect(commentCount).toBe(1);

        // Range markers are paragraph-level; ensure rebuild does NOT emit them
        // wrapped in synthetic <w:r> elements (which would be non-conformant).
        expect(parts.documentXml).not.toMatch(/<w:r\b[^>]*>\s*<w:commentRangeStart\b/);
        expect(parts.documentXml).not.toMatch(/<w:r\b[^>]*>\s*<w:commentRangeEnd\b/);

        // Issue #106: range markers must be present and at paragraph-level
        // position — direct children of w:p (consumerCompatibility hoists them
        // out of revision wrappers so they survive accept/reject).
        const starts = inspectElements(parts.documentXml, 'w:commentRangeStart');
        const ends = inspectElements(parts.documentXml, 'w:commentRangeEnd');
        expect(starts.length).toBeGreaterThan(0);
        expect(ends.length).toBeGreaterThan(0);
        const validParents = new Set(['w:p', 'w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);
        for (const m of [...starts, ...ends]) {
          expect(m.ancestors).not.toContain('w:r');
          expect(validParents.has(m.parent)).toBe(true);
        }

        expect(parts.contentTypesXml!).toContain('word/comments.xml');
        expect(parts.contentTypesXml!).toContain(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
        );

        expect(parts.relsXml!).toContain('comments.xml');
        expect(parts.relsXml!).toContain(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
        );
      });
    });
  });

  describe('Comment with commentsExtended/people added on revised side', () => {
    test('rebuild bootstraps commentsExtended.xml + people.xml when original lacks them', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no comments and revised adds one with ancillary parts', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Reply this',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('rebuild creates commentsExtended.xml and people.xml with OPC metadata', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        expect(parts.commentsExtendedXml).not.toBeNull();
        expect(parts.commentsExtendedXml!).toContain('w15:paraId="00000001"');

        expect(parts.peopleXml).not.toBeNull();
        expect(parts.peopleXml!).toContain('w15:author="Alice"');

        expect(parts.contentTypesXml!).toContain('commentsExtended.xml');
        expect(parts.contentTypesXml!).toContain('application/vnd.ms-word.commentsExtended+xml');
        expect(parts.contentTypesXml!).toContain('people.xml');
        expect(parts.contentTypesXml!).toContain('application/vnd.ms-word.people+xml');

        expect(parts.relsXml!).toContain('commentsExtended.xml');
        expect(parts.relsXml!).toContain(
          'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
        );
        expect(parts.relsXml!).toContain('people.xml');
        expect(parts.relsXml!).toContain(
          'http://schemas.microsoft.com/office/2011/relationships/people'
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Issue #108: Reply comments dropped in rebuild mode
  //
  // Root comments have a <w:commentReference> in document.xml; replies do not.
  // Replies thread through commentsExtended.xml via w15:paraIdParent. Before
  // the fix, the comment-merge post-pass only walked root comments referenced
  // in document.xml, so replies, their commentEx linkage, and the reply
  // author's people.xml entry were silently dropped from rebuild output.
  // ---------------------------------------------------------------------------
  describe('Reply comment added to existing root (issue #108, primary case)', () => {
    test('rebuild preserves reply when root already exists in original', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has root comment + ancillary parts; revised adds a reply', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Root question',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Root question',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
          replyText: 'Reply text',
          replyAuthor: 'Bob',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('reply comment, paraIdParent linkage, and reply author all survive', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        // Both comments present
        expect(parts.commentsXml).not.toBeNull();
        expect(parts.commentsXml!).toContain('w:id="1"');
        expect(parts.commentsXml!).toContain('w:id="2"');
        expect(parts.commentsXml!).toContain('Root question');
        expect(parts.commentsXml!).toContain('Reply text');
        expect(parts.commentsXml!).toContain('w:author="Alice"');
        expect(parts.commentsXml!).toContain('w:author="Bob"');

        // Threading preserved in commentsExtended.xml
        expect(parts.commentsExtendedXml).not.toBeNull();
        expect(parts.commentsExtendedXml!).toContain('w15:paraId="00000001"');
        expect(parts.commentsExtendedXml!).toContain('w15:paraId="00000002"');
        expect(parts.commentsExtendedXml!).toContain('w15:paraIdParent="00000001"');

        // Reply author present in people.xml
        expect(parts.peopleXml).not.toBeNull();
        expect(parts.peopleXml!).toContain('w15:author="Alice"');
        expect(parts.peopleXml!).toContain('w15:author="Bob"');
      });
    });
  });

  describe('Reply comment added on revised side (bootstrap case)', () => {
    test('rebuild bootstraps comments + ancillary parts including reply', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no comments; revised adds root + reply with ancillary parts', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Root question',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
          replyText: 'Reply text',
          replyAuthor: 'Bob',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('both comments and the threaded commentEx + people entries are bootstrapped', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        expect(parts.commentsXml).not.toBeNull();
        expect(parts.commentsXml!).toContain('w:id="1"');
        expect(parts.commentsXml!).toContain('w:id="2"');
        expect(parts.commentsXml!).toContain('Reply text');

        expect(parts.commentsExtendedXml).not.toBeNull();
        expect(parts.commentsExtendedXml!).toContain('w15:paraId="00000002"');
        expect(parts.commentsExtendedXml!).toContain('w15:paraIdParent="00000001"');

        expect(parts.peopleXml).not.toBeNull();
        expect(parts.peopleXml!).toContain('w15:author="Alice"');
        expect(parts.peopleXml!).toContain('w15:author="Bob"');
      });
    });
  });

  describe('Deep reply chain preserved in rebuild (issue #108)', () => {
    test('rebuild preserves a 3-level reply chain (root -> reply -> grandchild)', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('revised carries a 3-level threaded chain via inline archive mutation', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        });

        // Build a single-comment fixture, then splice in two more sibling
        // <w:comment> entries plus their commentEx and people entries.
        // We avoid extending SyntheticDocxOptions into a chain DSL — this
        // depth is an issue-#108 BFS regression check, not a recurring need.
        const baseRevised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Root',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
        });

        // Re-pack the archive with extra comment / commentEx / person entries.
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(baseRevised);

        const commentsXml = await zip.file('word/comments.xml')!.async('string');
        const replyAndGrandchild =
          `<w:comment w:id="2" w:author="Bob" w:date="2025-01-02T00:00:00Z">` +
          `<w:p w14:paraId="00000002"><w:r><w:t>Reply</w:t></w:r></w:p>` +
          `</w:comment>` +
          `<w:comment w:id="3" w:author="Carol" w:date="2025-01-03T00:00:00Z">` +
          `<w:p w14:paraId="00000003"><w:r><w:t>Grandchild</w:t></w:r></w:p>` +
          `</w:comment>`;
        zip.file(
          'word/comments.xml',
          commentsXml.replace('</w:comments>', `${replyAndGrandchild}</w:comments>`)
        );

        const exXml = await zip.file('word/commentsExtended.xml')!.async('string');
        const exExtra =
          `<w15:commentEx w15:paraId="00000002" w15:paraIdParent="00000001" w15:done="0"/>` +
          `<w15:commentEx w15:paraId="00000003" w15:paraIdParent="00000002" w15:done="0"/>`;
        zip.file(
          'word/commentsExtended.xml',
          exXml.replace('</w15:commentsEx>', `${exExtra}</w15:commentsEx>`)
        );

        const peopleXml = await zip.file('word/people.xml')!.async('string');
        const peopleExtra =
          `<w15:person w15:author="Bob"><w15:presenceInfo w15:providerId="None" w15:userId="bob@example.com"/></w15:person>` +
          `<w15:person w15:author="Carol"><w15:presenceInfo w15:providerId="None" w15:userId="carol@example.com"/></w15:person>`;
        zip.file(
          'word/people.xml',
          peopleXml.replace('</w15:people>', `${peopleExtra}</w15:people>`)
        );

        revised = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('all three comments + both linkages survive the BFS expansion', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        // All three comments present
        expect(parts.commentsXml!).toContain('w:id="1"');
        expect(parts.commentsXml!).toContain('w:id="2"');
        expect(parts.commentsXml!).toContain('w:id="3"');
        expect(parts.commentsXml!).toContain('Reply');
        expect(parts.commentsXml!).toContain('Grandchild');

        // Both linkages preserved
        expect(parts.commentsExtendedXml!).toContain('w15:paraId="00000003"');
        expect(parts.commentsExtendedXml!).toMatch(
          /w15:paraId="00000002"\s+w15:paraIdParent="00000001"/
        );
        expect(parts.commentsExtendedXml!).toMatch(
          /w15:paraId="00000003"\s+w15:paraIdParent="00000002"/
        );

        // All three authors in people.xml
        expect(parts.peopleXml!).toContain('w15:author="Alice"');
        expect(parts.peopleXml!).toContain('w15:author="Bob"');
        expect(parts.peopleXml!).toContain('w15:author="Carol"');
      });
    });
  });

  describe('Footnote present on both sides', () => {
    test('rebuild does not duplicate footnote definitions', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both documents share an identical footnote', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['Para A', 'Para B'],
          footnoteOnParagraph: 0,
          footnoteText: 'Shared footnote',
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['Para A', 'Para B'],
          footnoteOnParagraph: 0,
          footnoteText: 'Shared footnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('footnotes.xml has exactly one user-defined entry', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);
        expect(parts.footnotesXml).not.toBeNull();

        const userFootnoteCount = (parts.footnotesXml!.match(/<w:footnote w:id="1"/g) ?? []).length;
        expect(userFootnoteCount).toBe(1);
      });
    });
  });
});

describe('Paragraph-level marker reconstruction on rebuild (issue #106)', () => {
  describe('Cross-paragraph comment span', () => {
    test('rebuild keeps commentRangeStart and commentRangeEnd in their respective paragraphs', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has two plain paragraphs and revised adds a comment spanning both', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          commentSpanParagraphs: { start: 0, end: 1 },
          commentText: 'Spanning comment',
          commentAuthor: 'Reviewer',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('start and end markers survive rebuild at paragraph level with matching ids', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);

        const starts = inspectElements(parts.documentXml, 'w:commentRangeStart');
        const ends = inspectElements(parts.documentXml, 'w:commentRangeEnd');
        expect(starts.length).toBe(1);
        expect(ends.length).toBe(1);
        expect(starts[0]!.idAttr).toBe(ends[0]!.idAttr);

        const validParents = new Set(['w:p', 'w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);
        for (const m of [...starts, ...ends]) {
          expect(m.ancestors).not.toContain('w:r');
          expect(validParents.has(m.parent)).toBe(true);
        }
      });
    });
  });

  describe('Sibling-style scaffold markers', () => {
    test('body-level bookmarks are stripped on rebuild and do not leak into reconstructed paragraphs', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has a sibling-style bookmark between two paragraphs', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['Para A', 'Para B'],
          siblingBookmarkBefore: { index: 1, name: '_scaffold_bookmark', id: 999 },
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['Para A revised', 'Para B'],
          siblingBookmarkBefore: { index: 1, name: '_scaffold_bookmark', id: 999 },
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('the body-level bookmark does not appear inside any reconstructed <w:p>', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);

        // Scaffold-strip removes body-level scaffold bookmarks. After
        // strip+balance, any surviving start must not be inside a <w:p>.
        const starts = inspectElements(parts.documentXml, 'w:bookmarkStart').filter(
          (m) => m.idAttr === '999'
        );
        for (const m of starts) {
          expect(m.ancestors).not.toContain('w:p');
        }
      });
    });
  });

  describe('Inplace regression — comment span', () => {
    test('inplace mode succeeds with a cross-paragraph comment span on the revised side', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has plain paragraphs and revised adds a spanning comment', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          commentSpanParagraphs: { start: 0, end: 1 },
          commentText: 'Spanning comment',
          commentAuthor: 'Reviewer',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });

      await then('inplace mode is used (no fallback) and output is structurally valid', async () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        const parts = await getResultParts(result.document);
        // inplace output must contain the comment anchor; the full span survives
        // because the markers are already present in the revised archive.
        expect(parts.documentXml).toContain('w:commentReference');
      });
    });
  });
});

describe('Multi-paragraph sibling comment ranges on rebuild (issue #103)', () => {
  describe('Body-level comment range wrapping whole paragraphs', () => {
    test('rebuild preserves matched sibling-level commentRangeStart/End markers', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides have a comment range whose markers sit outside any <w:p>, wrapping the first two paragraphs', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph', 'Third paragraph'],
          siblingCommentRange: { startBeforeParagraph: 0, endAfterParagraph: 1 },
          commentText: 'Spanning comment',
          commentAuthor: 'Reviewer',
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph revised', 'Third paragraph'],
          siblingCommentRange: { startBeforeParagraph: 0, endAfterParagraph: 1 },
          commentText: 'Spanning comment',
          commentAuthor: 'Reviewer',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('both range markers survive at body level with matching ids and the anchor is intact', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);

        const starts = inspectElements(parts.documentXml, 'w:commentRangeStart');
        const ends = inspectElements(parts.documentXml, 'w:commentRangeEnd');
        expect(starts.length).toBe(1);
        expect(ends.length).toBe(1);
        expect(starts[0]!.idAttr).toBe(ends[0]!.idAttr);

        // The markers wrap whole paragraphs, so they must stay siblings of
        // <w:p>, not get pulled inside a reconstructed paragraph.
        for (const m of [...starts, ...ends]) {
          expect(m.ancestors).not.toContain('w:p');
          expect(m.parent).toBe('w:body');
        }

        // The comment anchor and definition must still be present.
        expect(parts.documentXml).toContain('w:commentReference');
        expect(parts.commentsXml).toContain('Spanning comment');
      });
    });
  });

  describe('Orphaned body-level comment range remnant', () => {
    test('a sibling commentRangeStart with no matching end is still stripped', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides carry an unmatched body-level commentRangeStart between two paragraphs', async () => {
        const bodyXml = (textA: string) =>
          `<w:p><w:r><w:t>${textA}</w:t></w:r></w:p>` +
          `<w:commentRangeStart w:id="7"/>` +
          `<w:p><w:r><w:t>Para B</w:t></w:r></w:p>`;
        original = await buildDocxFromBodyXml(bodyXml('Para A'));
        revised = await buildDocxFromBodyXml(bodyXml('Para A revised'));
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('the orphaned marker does not survive into the rebuilt document', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);
        expect(parts.documentXml).not.toContain('w:commentRangeStart');
      });
    });
  });
});
