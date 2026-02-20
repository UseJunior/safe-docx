import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML } from './namespaces.js';
import { extractRevisions } from './extract_revisions.js';
import { insertParagraphBookmarks } from './bookmarks.js';
import type { Comment } from './comments.js';

const W_NS = OOXML.W_NS;

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
  it('should return empty result for a document with no tracked changes', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it('should extract insertions with before/after text', () => {
    const doc = makeDoc(
      '<w:p>' +
        '<w:r><w:t>Original</w:t></w:r>' +
        '<w:ins w:author="Alice" w:date="2024-01-01T00:00:00Z">' +
          '<w:r><w:t> added</w:t></w:r>' +
        '</w:ins>' +
      '</w:p>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    expect(result.changes[0]!.before_text).toBe('Original');
    expect(result.changes[0]!.after_text).toBe('Original added');
    expect(result.changes[0]!.revisions).toHaveLength(1);
    expect(result.changes[0]!.revisions[0]!.type).toBe('INSERTION');
    expect(result.changes[0]!.revisions[0]!.text).toBe(' added');
    expect(result.changes[0]!.revisions[0]!.author).toBe('Alice');
  });

  it('should extract deletions with before/after text (w:delText restored)', () => {
    const doc = makeDoc(
      '<w:p>' +
        '<w:r><w:t>Keep</w:t></w:r>' +
        '<w:del w:author="Bob">' +
          '<w:r><w:delText> deleted</w:delText></w:r>' +
        '</w:del>' +
      '</w:p>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    expect(result.changes[0]!.before_text).toBe('Keep deleted');
    expect(result.changes[0]!.after_text).toBe('Keep');
    expect(result.changes[0]!.revisions[0]!.type).toBe('DELETION');
    expect(result.changes[0]!.revisions[0]!.text).toBe(' deleted');
  });

  it('should return empty before_text for entirely inserted paragraph', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>Existing</w:t></w:r></w:p>' +
      '<w:p>' +
        '<w:ins w:author="Author">' +
          '<w:r><w:t>New paragraph</w:t></w:r>' +
        '</w:ins>' +
      '</w:p>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    const change = result.changes[0]!;
    expect(change.before_text).toBe('');
    expect(change.after_text).toBe('New paragraph');
  });

  it('should return empty after_text for entirely deleted paragraph', () => {
    const doc = makeDoc(
      '<w:p>' +
        '<w:del w:author="Author">' +
          '<w:r><w:delText>Removed paragraph</w:delText></w:r>' +
        '</w:del>' +
      '</w:p>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    const change = result.changes[0]!;
    expect(change.before_text).toBe('Removed paragraph');
    expect(change.after_text).toBe('');
  });

  it('should extract FORMAT_CHANGE from rPrChange', () => {
    const doc = makeDoc(
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
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    expect(result.changes[0]!.revisions).toHaveLength(1);
    expect(result.changes[0]!.revisions[0]!.type).toBe('FORMAT_CHANGE');
    expect(result.changes[0]!.revisions[0]!.author).toBe('Carol');
  });

  it('should skip unchanged paragraphs', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>No changes here</w:t></w:r></w:p>' +
      '<w:p>' +
        '<w:r><w:t>Has </w:t></w:r>' +
        '<w:ins w:author="Author"><w:r><w:t>insertion</w:t></w:r></w:ins>' +
      '</w:p>' +
      '<w:p><w:r><w:t>Also clean</w:t></w:r></w:p>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    expect(result.changes[0]!.para_id).toBeDefined();
  });

  it('should extract changes inside table cells', () => {
    const doc = makeDoc(
      '<w:tbl><w:tr><w:tc>' +
        '<w:p>' +
          '<w:r><w:t>Cell text</w:t></w:r>' +
          '<w:ins w:author="Author"><w:r><w:t> added</w:t></w:r></w:ins>' +
        '</w:p>' +
      '</w:tc></w:tr></w:tbl>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(1);
    expect(result.changes[0]!.after_text).toBe('Cell text added');
  });

  it('should associate comments with changed paragraphs', () => {
    const doc = makeDoc(
      '<w:p>' +
        '<w:r><w:t>Text</w:t></w:r>' +
        '<w:ins w:author="Author"><w:r><w:t> added</w:t></w:r></w:ins>' +
      '</w:p>',
    );

    // Get the paragraph's bookmark ID for the mock comment
    const paras = doc.getElementsByTagNameNS(W_NS, 'p');
    const firstP = paras[0]!;
    const bookmarkStarts = firstP.getElementsByTagNameNS(W_NS, 'bookmarkStart');
    let paraId = '';
    for (let i = 0; i < bookmarkStarts.length; i++) {
      const name = bookmarkStarts[i]!.getAttributeNS(W_NS, 'name') ?? bookmarkStarts[i]!.getAttribute('w:name') ?? '';
      if (name.startsWith('jr_para_')) {
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
          if (name.startsWith('jr_para_')) { paraId = name; break; }
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

    const result = extractRevisions(doc, comments);
    expect(result.total_changes).toBe(1);
    expect(result.changes[0]!.comments).toHaveLength(1);
    expect(result.changes[0]!.comments[0]!.author).toBe('Reviewer');
    expect(result.changes[0]!.comments[0]!.text).toBe('Nice addition!');
  });

  it('should paginate with offset and limit', () => {
    // Create a doc with multiple changed paragraphs
    const doc = makeDoc(
      '<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>',
    );

    // Page 1
    const page1 = extractRevisions(doc, [], { offset: 0, limit: 2 });
    expect(page1.total_changes).toBe(3);
    expect(page1.changes).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    // Page 2
    const page2 = extractRevisions(doc, [], { offset: 2, limit: 2 });
    expect(page2.total_changes).toBe(3);
    expect(page2.changes).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });

  it('should return empty array when offset exceeds total', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>',
    );
    const result = extractRevisions(doc, [], { offset: 10 });
    expect(result.total_changes).toBe(1);
    expect(result.changes).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it('should filter out structurally-empty inserted paragraphs', () => {
    // Paragraph with only pPr/rPr/ins (paragraph-level marker, no text)
    const doc = makeDoc(
      '<w:p><w:r><w:t>Normal</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>' +
      '<w:p><w:r><w:t>Also normal</w:t></w:r></w:p>',
    );
    const result = extractRevisions(doc, []);
    expect(result.total_changes).toBe(0);
    expect(result.changes).toEqual([]);
  });

  it('should not overlap pages in document order', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:r><w:t>D</w:t></w:r><w:ins w:author="X"><w:r><w:t>4</w:t></w:r></w:ins></w:p>',
    );

    const page1 = extractRevisions(doc, [], { offset: 0, limit: 2 });
    const page2 = extractRevisions(doc, [], { offset: 2, limit: 2 });

    const page1Ids = new Set(page1.changes.map((c) => c.para_id));
    const page2Ids = new Set(page2.changes.map((c) => c.para_id));

    // No overlap
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });
});
