import { describe, expect } from 'vitest';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import {
  findParagraphByBookmarkId,
  getParagraphBookmarkId,
  getParagraphBookmarkNames,
  insertParagraphBookmarks,
} from '../src/primitives/bookmarks.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const TEST_FEATURE = 'document-paragraph-id-stability-and-fingerprint';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

/** A paragraph wrapped in a host-owned (non `_bk_`) sibling bookmark. */
function hostBookmarked(name: string, text: string, id: number): string {
  return (
    `<w:bookmarkStart w:id="${id}" w:name="${name}"/>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `<w:bookmarkEnd w:id="${id}"/>`
  );
}

function paragraphText(p: Element): string {
  const ts = p.getElementsByTagNameNS(OOXML.W_NS, 't');
  let out = '';
  for (let i = 0; i < ts.length; i++) out += ts.item(i)?.textContent ?? '';
  return out;
}

describe('Traceability: document-paragraph-id-stability-and-fingerprint — Foreign Bookmark Anchors', () => {
  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: a host-owned bookmark resolves as an edit anchor',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = await given('a document whose paragraphs carry host bookmarks', () =>
        makeDoc(
          hostBookmarked('jr_para_aaaa1111', 'First', 1) +
            hostBookmarked('jr_para_bbbb2222', 'Second', 2),
        ),
      );

      const found = await when('the host bookmark name is used as an anchor', () =>
        findParagraphByBookmarkId(doc, 'jr_para_bbbb2222'),
      );

      await then('it resolves to that exact paragraph', () => {
        expect(found).not.toBeNull();
        expect(paragraphText(found as Element)).toBe('Second');
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: host bookmarks disambiguate paragraphs with identical text',
    async ({ given, when, then }: AllureBddContext) => {
      // Identical text is exactly the case a text-matching bridge cannot resolve.
      const doc = await given('two paragraphs with identical text and distinct host bookmarks', () =>
        makeDoc(
          hostBookmarked('jr_para_first', 'Identical text', 1) +
            hostBookmarked('jr_para_second', 'Identical text', 2),
        ),
      );

      const [first, second] = await when('each host bookmark is resolved', () => [
        findParagraphByBookmarkId(doc, 'jr_para_first'),
        findParagraphByBookmarkId(doc, 'jr_para_second'),
      ]);

      await then('each resolves to a distinct paragraph', () => {
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first).not.toBe(second);
        expect(paragraphText(first as Element)).toBe('Identical text');
        expect(paragraphText(second as Element)).toBe('Identical text');
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: stacked host and safe-docx bookmarks both resolve to one paragraph',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = await given('a host-bookmarked document that safe-docx has also indexed', () => {
        const d = makeDoc(hostBookmarked('jr_para_stacked', 'Body text', 1));
        insertParagraphBookmarks(d, 'test-attachment');
        return d;
      });

      await then('the canonical reported id is still the safe-docx _bk_ id', () => {
        const p = doc.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element;
        const names = getParagraphBookmarkNames(p);
        expect(names).toContain('jr_para_stacked');
        expect(getParagraphBookmarkId(p)).toMatch(/^_bk_[0-9a-f]{12}$/);
      });

      await when('either name is used as an anchor', () => undefined);

      await then('both resolve to the same paragraph', () => {
        const p = doc.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element;
        const canonical = getParagraphBookmarkId(p) as string;
        expect(findParagraphByBookmarkId(doc, 'jr_para_stacked')).toBe(
          findParagraphByBookmarkId(doc, canonical),
        );
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: an unknown bookmark name still resolves to nothing',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = await given('a host-bookmarked document', () =>
        makeDoc(hostBookmarked('jr_para_known', 'Body', 1)),
      );

      const found = await when('an unknown name is used as an anchor', () =>
        findParagraphByBookmarkId(doc, 'jr_para_does_not_exist'),
      );

      await then('resolution fails rather than guessing a paragraph', () => {
        expect(found).toBeNull();
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: a zero-length point bookmark next to a paragraph is not its anchor',
    async ({ given, when, then }: AllureBddContext) => {
      // Bookmarks pair start/end by w:id — adjacency is not ownership.
      // A point bookmark sitting just before a paragraph marks NO paragraph.
      const doc = await given('a zero-length bookmark immediately before a paragraph', () =>
        makeDoc(
          `<w:bookmarkStart w:id="9" w:name="_RefPoint"/><w:bookmarkEnd w:id="9"/>` +
            hostBookmarked('jr_para_real', 'target', 1),
        ),
      );

      const found = await when('the point bookmark name is used as an anchor', () =>
        findParagraphByBookmarkId(doc, '_RefPoint'),
      );

      await then('it resolves to nothing rather than the neighbouring paragraph', () => {
        expect(found).toBeNull();
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: a bookmark spanning several paragraphs is not any one paragraph\'s anchor',
    async ({ given, when, then }: AllureBddContext) => {
      const sibling = await given('a sibling-style bookmark wrapping three paragraphs', () =>
        makeDoc(
          `<w:bookmarkStart w:id="9" w:name="_TocOuterSpan"/>` +
            `<w:p><w:r><w:t>first</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>second</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>third</w:t></w:r></w:p>` +
            `<w:bookmarkEnd w:id="9"/>`,
        ),
      );
      const inline = await given('an inline bookmark starting in the first paragraph and ending in the third', () =>
        makeDoc(
          `<w:p><w:bookmarkStart w:id="7" w:name="_TocInlineSpan"/><w:r><w:t>first</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>second</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>third</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>`,
        ),
      );

      const [a, b] = await when('each spanning bookmark is used as an anchor', () => [
        findParagraphByBookmarkId(sibling, '_TocOuterSpan'),
        findParagraphByBookmarkId(inline, '_TocInlineSpan'),
      ]);

      await then('neither resolves — a multi-paragraph range marks no single paragraph', () => {
        expect(a).toBeNull();
        expect(b).toBeNull();
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: a foreign bookmark inside one paragraph resolves to it',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = await given('a bookmark opened and closed inside a single paragraph', () =>
        makeDoc(
          `<w:p><w:bookmarkStart w:id="4" w:name="jr_para_inline"/><w:r><w:t>inline target</w:t></w:r>` +
            `<w:bookmarkEnd w:id="4"/></w:p><w:p><w:r><w:t>other</w:t></w:r></w:p>`,
        ),
      );

      const found = await when('the inside-style name is used as an anchor', () =>
        findParagraphByBookmarkId(doc, 'jr_para_inline'),
      );

      await then('it resolves to that paragraph', () => {
        expect(found).not.toBeNull();
        expect(paragraphText(found as Element)).toBe('inline target');
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: an unpaired or duplicated bookmark name refuses to resolve',
    async ({ given, when, then }: AllureBddContext) => {
      const unpaired = await given('a bookmarkStart whose w:id has no matching end', () =>
        makeDoc(
          `<w:bookmarkStart w:id="3" w:name="jr_para_unpaired"/>` +
            `<w:p><w:r><w:t>orphan</w:t></w:r></w:p><w:bookmarkEnd w:id="99"/>`,
        ),
      );
      const duplicated = await given('two different paragraphs carrying the same foreign name', () =>
        makeDoc(hostBookmarked('jr_para_dup', 'first', 1) + hostBookmarked('jr_para_dup', 'second', 2)),
      );

      const [a, b] = await when('each malformed name is used as an anchor', () => [
        findParagraphByBookmarkId(unpaired, 'jr_para_unpaired'),
        findParagraphByBookmarkId(duplicated, 'jr_para_dup'),
      ]);

      await then('both refuse rather than guessing a paragraph', () => {
        expect(a).toBeNull();
        expect(b).toBeNull();
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: stacked _bk_ names do not move an existing canonical lookup',
    async ({ given, when, then }: AllureBddContext) => {
      // Regression: widening resolution must not change where a canonical id
      // resolves. Here paragraph 1 carries _bk_target as a NON-reported name.
      const doc = await given('a paragraph carrying two _bk_ names and a second owning the reported one', () =>
        makeDoc(
          `<w:bookmarkStart w:id="1" w:name="_bk_target"/><w:bookmarkStart w:id="2" w:name="_bk_other"/>` +
            `<w:p><w:r><w:t>first</w:t></w:r></w:p><w:bookmarkEnd w:id="2"/><w:bookmarkEnd w:id="1"/>` +
            `<w:bookmarkStart w:id="3" w:name="_bk_target"/><w:p><w:r><w:t>second</w:t></w:r></w:p>` +
            `<w:bookmarkEnd w:id="3"/>`,
        ),
      );

      await then('paragraph 1 reports _bk_other, so _bk_target belongs to paragraph 2', () => {
        const ps = doc.getElementsByTagNameNS(OOXML.W_NS, 'p');
        expect(getParagraphBookmarkId(ps.item(0) as Element)).toBe('_bk_other');
        expect(getParagraphBookmarkId(ps.item(1) as Element)).toBe('_bk_target');
      });

      const found = await when('the canonical id is used as an anchor', () =>
        findParagraphByBookmarkId(doc, '_bk_target'),
      );

      await then('it still resolves to the paragraph that reports it', () => {
        expect(paragraphText(found as Element)).toBe('second');
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: a zero-length point bookmark INSIDE a paragraph is not its anchor',
    async ({ given, when, then }: AllureBddContext) => {
      // A point bookmark marks no content wherever it sits. Measuring the marker
      // positions (rather than the content between them) previously let an
      // inline point resolve to — and mutate — its enclosing paragraph.
      const doc = await given('a bookmark opened and immediately closed inside a paragraph', () =>
        makeDoc(
          `<w:p><w:r><w:t>before</w:t></w:r>` +
            `<w:bookmarkStart w:id="5" w:name="_RefPointInside"/><w:bookmarkEnd w:id="5"/>` +
            `<w:r><w:t>after</w:t></w:r></w:p>`,
        ),
      );

      const found = await when('the inline point bookmark name is used as an anchor', () =>
        findParagraphByBookmarkId(doc, '_RefPointInside'),
      );

      await then('it resolves to nothing rather than the enclosing paragraph', () => {
        expect(found).toBeNull();
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: an end marker preceding its start does not resolve',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = await given('a bookmarkEnd positioned before its bookmarkStart', () =>
        makeDoc(
          `<w:p><w:r><w:t>before</w:t></w:r><w:bookmarkEnd w:id="6"/>` +
            `<w:r><w:t>middle</w:t></w:r><w:bookmarkStart w:id="6" w:name="_RefReversed"/>` +
            `<w:r><w:t>after</w:t></w:r></w:p>`,
        ),
      );

      const found = await when('the reversed bookmark name is used as an anchor', () =>
        findParagraphByBookmarkId(doc, '_RefReversed'),
      );

      await then('the malformed range is refused', () => {
        expect(found).toBeNull();
      });
    },
  );

  test.openspec('an anchor may be any bookmark name on the paragraph')(
    'Scenario: two bookmarkStarts sharing one w:id are ambiguous and refused',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = await given('two differently-named starts reusing a single w:id', () =>
        makeDoc(
          `<w:bookmarkStart w:id="8" w:name="jr_para_dupid_first"/>` +
            `<w:p><w:r><w:t>first</w:t></w:r></w:p>` +
            `<w:bookmarkStart w:id="8" w:name="jr_para_dupid_second"/>` +
            `<w:p><w:r><w:t>second</w:t></w:r></w:p><w:bookmarkEnd w:id="8"/>`,
        ),
      );

      const [a, b] = await when('each name sharing the w:id is used as an anchor', () => [
        findParagraphByBookmarkId(doc, 'jr_para_dupid_first'),
        findParagraphByBookmarkId(doc, 'jr_para_dupid_second'),
      ]);

      await then('neither resolves — the pairing is ambiguous', () => {
        expect(a).toBeNull();
        expect(b).toBeNull();
      });
    },
  );
});
