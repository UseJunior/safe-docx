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
});
