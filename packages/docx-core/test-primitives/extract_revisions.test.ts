import { describe, expect } from 'vitest';
import { type AllureBddContext, testAllure } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { extractRevisions } from '../src/primitives/extract_revisions.js';
import { insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import type { Comment } from '../src/primitives/comments.js';

const W_NS = OOXML.W_NS;

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Extract Revisions' });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  const doc = parseXml(xml);
  // Insert bookmarks to simulate session open behavior
  insertParagraphBookmarks(doc, 'test');
  return doc;
}

describe('extractRevisions', () => {
  test('should return empty result for a document with no tracked changes', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with no tracked changes', async () => {
      doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('total_changes is 0', async () => {
      expect(result.total_changes).toBe(0);
    });

    await and('changes array is empty', async () => {
      expect(result.changes).toEqual([]);
    });

    await and('has_more is false', async () => {
      expect(result.has_more).toBe(false);
    });
  });

  test('should extract insertions with before/after text', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with an insertion by Alice', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Original</w:t></w:r>' +
          '<w:ins w:author="Alice" w:date="2024-01-01T00:00:00Z">' +
            '<w:r><w:t> added</w:t></w:r>' +
          '</w:ins>' +
        '</w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('before_text is the original text', async () => {
      expect(result.changes[0]!.before_text).toBe('Original');
    });

    await and('after_text includes the inserted text', async () => {
      expect(result.changes[0]!.after_text).toBe('Original added');
    });

    await and('the revision is an INSERTION by Alice', async () => {
      expect(result.changes[0]!.revisions).toHaveLength(1);
      expect(result.changes[0]!.revisions[0]!.type).toBe('INSERTION');
      expect(result.changes[0]!.revisions[0]!.text).toBe(' added');
      expect(result.changes[0]!.revisions[0]!.author).toBe('Alice');
    });
  });

  test('should extract deletions with before/after text (w:delText restored)', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with a deletion by Bob', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Keep</w:t></w:r>' +
          '<w:del w:author="Bob">' +
            '<w:r><w:delText> deleted</w:delText></w:r>' +
          '</w:del>' +
        '</w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('before_text includes the deleted text', async () => {
      expect(result.changes[0]!.before_text).toBe('Keep deleted');
    });

    await and('after_text excludes the deleted text', async () => {
      expect(result.changes[0]!.after_text).toBe('Keep');
    });

    await and('the revision is a DELETION', async () => {
      expect(result.changes[0]!.revisions[0]!.type).toBe('DELETION');
      expect(result.changes[0]!.revisions[0]!.text).toBe(' deleted');
    });
  });

  test('should return empty before_text for entirely inserted paragraph', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with an entirely inserted paragraph', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>Existing</w:t></w:r></w:p>' +
        '<w:p>' +
          '<w:ins w:author="Author">' +
            '<w:r><w:t>New paragraph</w:t></w:r>' +
          '</w:ins>' +
        '</w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('before_text is empty', async () => {
      const change = result.changes[0]!;
      expect(change.before_text).toBe('');
    });

    await and('after_text is the inserted text', async () => {
      const change = result.changes[0]!;
      expect(change.after_text).toBe('New paragraph');
    });
  });

  test('should return empty after_text for entirely deleted paragraph', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with an entirely deleted paragraph', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:del w:author="Author">' +
            '<w:r><w:delText>Removed paragraph</w:delText></w:r>' +
          '</w:del>' +
        '</w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('before_text is the deleted text', async () => {
      const change = result.changes[0]!;
      expect(change.before_text).toBe('Removed paragraph');
    });

    await and('after_text is empty', async () => {
      const change = result.changes[0]!;
      expect(change.after_text).toBe('');
    });
  });

  test('should extract FORMAT_CHANGE from rPrChange', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with a format change by Carol', async () => {
      doc = makeDoc(
        '<w:p><w:r>' +
          '<w:rPr>' +
            '<w:b/>' +
            '<w:rPrChange w:author="Carol">' +
              '<w:rPr><w:i/></w:rPr>' +
            '</w:rPrChange>' +
          '</w:rPr>' +
          '<w:t>Formatted</w:t>' +
        '</w:r></w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('the revision is a FORMAT_CHANGE by Carol', async () => {
      expect(result.changes[0]!.revisions).toHaveLength(1);
      expect(result.changes[0]!.revisions[0]!.type).toBe('FORMAT_CHANGE');
      expect(result.changes[0]!.revisions[0]!.author).toBe('Carol');
    });
  });

  test('should skip unchanged paragraphs', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with two clean paragraphs and one with an insertion', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>No changes here</w:t></w:r></w:p>' +
        '<w:p>' +
          '<w:r><w:t>Has </w:t></w:r>' +
          '<w:ins w:author="Author"><w:r><w:t>insertion</w:t></w:r></w:ins>' +
        '</w:p>' +
        '<w:p><w:r><w:t>Also clean</w:t></w:r></w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('only one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('the change has a para_id', async () => {
      expect(result.changes[0]!.para_id).toBeDefined();
    });
  });

  test('should extract changes inside table cells', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with a tracked change inside a table cell', async () => {
      doc = makeDoc(
        '<w:tbl><w:tr><w:tc>' +
          '<w:p>' +
            '<w:r><w:t>Cell text</w:t></w:r>' +
            '<w:ins w:author="Author"><w:r><w:t> added</w:t></w:r></w:ins>' +
          '</w:p>' +
        '</w:tc></w:tr></w:tbl>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('one change is returned with the combined text', async () => {
      expect(result.total_changes).toBe(1);
      expect(result.changes[0]!.after_text).toBe('Cell text added');
    });
  });

  test('should associate comments with changed paragraphs', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with an insertion and a comment on the same paragraph', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Text</w:t></w:r>' +
          '<w:ins w:author="Author"><w:r><w:t> added</w:t></w:r></w:ins>' +
        '</w:p>',
      );
    });

    await when('extractRevisions is called with a matching comment', async () => {
      // Get the paragraph's bookmark ID for the mock comment
      const paras = doc.getElementsByTagNameNS(W_NS, 'p');
      const firstP = paras[0]!;
      const bookmarkStarts = firstP.getElementsByTagNameNS(W_NS, 'bookmarkStart');
      let paraId = '';
      for (let i = 0; i < bookmarkStarts.length; i++) {
        const name = bookmarkStarts[i]!.getAttributeNS(W_NS, 'name') ?? bookmarkStarts[i]!.getAttribute('w:name') ?? '';
        if (name.startsWith('_bk_')) {
          paraId = name;
          break;
        }
      }
      // Check sibling-style bookmarks
      if (!paraId) {
        let prev = firstP.previousSibling;
        while (prev) {
          if (prev.nodeType === 1 && (prev as Element).localName === 'bookmarkStart') {
            const name = (prev as Element).getAttributeNS(W_NS, 'name') ?? (prev as Element).getAttribute('w:name') ?? '';
            if (name.startsWith('_bk_')) { paraId = name; break; }
          }
          prev = prev.previousSibling;
        }
      }

      const comments: Comment[] = [{
        id: 1,
        author: 'Reviewer',
        date: '2024-01-01T00:00:00Z',
        initials: 'R',
        text: 'Nice addition!',
        paragraphId: 'COMMENT_PARA_ID',
        anchoredParagraphId: paraId,
        replies: [],
      }];

      result = extractRevisions(doc, comments);
    });

    await then('one change is returned', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('the comment is associated with the change', async () => {
      expect(result.changes[0]!.comments).toHaveLength(1);
      expect(result.changes[0]!.comments[0]!.author).toBe('Reviewer');
      expect(result.changes[0]!.comments[0]!.text).toBe('Nice addition!');
    });
  });

  test('should paginate with offset and limit', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let page1: ReturnType<typeof extractRevisions>;
    let page2: ReturnType<typeof extractRevisions>;

    await given('a document with three changed paragraphs', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>' +
        '<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>' +
        '<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>',
      );
    });

    await when('extractRevisions is called with offset=0 limit=2', async () => {
      page1 = extractRevisions(doc, [], { offset: 0, limit: 2 });
    });

    await then('page 1 returns 2 changes with has_more=true', async () => {
      expect(page1.total_changes).toBe(3);
      expect(page1.changes).toHaveLength(2);
      expect(page1.has_more).toBe(true);
    });

    await and('page 2 with offset=2 returns 1 change with has_more=false', async () => {
      page2 = extractRevisions(doc, [], { offset: 2, limit: 2 });
      expect(page2.total_changes).toBe(3);
      expect(page2.changes).toHaveLength(1);
      expect(page2.has_more).toBe(false);
    });
  });

  test('should return empty array when offset exceeds total', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with one changed paragraph', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>',
      );
    });

    await when('extractRevisions is called with offset=10', async () => {
      result = extractRevisions(doc, [], { offset: 10 });
    });

    await then('total_changes reflects the actual count', async () => {
      expect(result.total_changes).toBe(1);
    });

    await and('changes array is empty', async () => {
      expect(result.changes).toEqual([]);
    });

    await and('has_more is false', async () => {
      expect(result.has_more).toBe(false);
    });
  });

  test('should filter out structurally-empty inserted paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof extractRevisions>;

    await given('a document with a paragraph-level ins marker but no text', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>Normal</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>' +
        '<w:p><w:r><w:t>Also normal</w:t></w:r></w:p>',
      );
    });

    await when('extractRevisions is called', async () => {
      result = extractRevisions(doc, []);
    });

    await then('no changes are returned', async () => {
      expect(result.total_changes).toBe(0);
      expect(result.changes).toEqual([]);
    });
  });

  test('should not overlap pages in document order', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let page1: ReturnType<typeof extractRevisions>;
    let page2: ReturnType<typeof extractRevisions>;

    await given('a document with four changed paragraphs', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>' +
        '<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>' +
        '<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>' +
        '<w:p><w:r><w:t>D</w:t></w:r><w:ins w:author="X"><w:r><w:t>4</w:t></w:r></w:ins></w:p>',
      );
    });

    await when('two pages are fetched with limit=2', async () => {
      page1 = extractRevisions(doc, [], { offset: 0, limit: 2 });
      page2 = extractRevisions(doc, [], { offset: 2, limit: 2 });
    });

    await then('no para_id appears in both pages', async () => {
      const page1Ids = new Set(page1.changes.map((c) => c.para_id));
      const page2Ids = new Set(page2.changes.map((c) => c.para_id));

      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });
  });
});
