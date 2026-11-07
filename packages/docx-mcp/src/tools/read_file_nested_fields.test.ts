import { describe, expect, it } from 'vitest';
import { FieldTracker, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { readFile } from './read_file.js';

const test = testAllure.epic('Document Reading').withLabels({ feature: 'Shared Nested Field Traversal' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parseParagraph(xml: string): Element {
  const doc = parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${xml}</w:body></w:document>`);
  return doc.getElementsByTagNameNS(W_NS, 'p').item(0)!;
}

function makeDocxZipXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    `<w:body>${bodyXml}<w:sectPr/></w:body>` +
    `</w:document>`
  );
}

describe('FieldTracker unit and integration behavior for read_file', () => {
  it('correctly tracks nested field instruction and result boundaries', () => {
    const tracker = new FieldTracker({ strict: false, story: 'document' });

    // Outer field begin
    tracker.advanceFieldChar('begin');
    expect(tracker.depth).toBe(1);
    expect(tracker.isInsideFieldCode()).toBe(true);
    expect(tracker.isTextVisible()).toBe(false);

    // Inner field begin
    tracker.advanceFieldChar('begin');
    expect(tracker.depth).toBe(2);
    expect(tracker.isInsideFieldCode()).toBe(true);

    // Inner field separate & end
    tracker.advanceFieldChar('separate');
    expect(tracker.isInsideFieldCode()).toBe(true); // Outer is still in code
    tracker.advanceFieldChar('end');
    expect(tracker.depth).toBe(1);
    expect(tracker.isInsideFieldCode()).toBe(true);

    // Outer field separate
    tracker.advanceFieldChar('separate');
    expect(tracker.depth).toBe(1);
    expect(tracker.isInsideFieldCode()).toBe(false);
    expect(tracker.isInsideFieldResult()).toBe(true);
    expect(tracker.isTextVisible()).toBe(true);

    // Outer field end
    tracker.advanceFieldChar('end');
    expect(tracker.depth).toBe(0);
    expect(tracker.isTextVisible()).toBe(true);
  });

  it('tolerates optional separators, stray markers, and duplicate markers without failing', () => {
    const tracker = new FieldTracker({ strict: false, story: 'document' });

    // Stray markers
    tracker.advanceFieldChar('separate');
    expect(tracker.depth).toBe(0);
    tracker.advanceFieldChar('end');
    expect(tracker.depth).toBe(0);

    // Optional separator (begin then directly end)
    tracker.advanceFieldChar('begin');
    expect(tracker.depth).toBe(1);
    expect(tracker.isInsideFieldCode()).toBe(true);
    tracker.advanceFieldChar('end');
    expect(tracker.depth).toBe(0);
    expect(tracker.isTextVisible()).toBe(true);

    // Duplicate separator
    tracker.advanceFieldChar('begin');
    tracker.advanceFieldChar('separate');
    expect(tracker.isInsideFieldResult()).toBe(true);
    tracker.advanceFieldChar('separate');
    expect(tracker.isInsideFieldResult()).toBe(true);
    tracker.advanceFieldChar('end');
    expect(tracker.depth).toBe(0);
  });

  it('preserves field stack across sequential paragraph boundaries', () => {
    const tracker = new FieldTracker({ strict: false, story: 'document' });

    // Paragraph 1: has begin and instrText
    const p1 = parseParagraph(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> IF 1 = 1 </w:instrText></w:r></w:p>',
    );
    for (const r of Array.from(p1.getElementsByTagNameNS(W_NS, 'r'))) {
      for (const child of Array.from(r.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        if (el.localName === 'fldChar') tracker.advanceFieldChar(el.getAttribute('w:fldCharType'));
      }
    }

    expect(tracker.depth).toBe(1);
    expect(tracker.isInsideFieldCode()).toBe(true);

    // Paragraph 2: continues field, reaches separate, result text, and end
    const p2 = parseParagraph(
      '<w:p><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>Evaluated True</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );

    let p2VisibleChars = 0;
    for (const r of Array.from(p2.getElementsByTagNameNS(W_NS, 'r'))) {
      for (const child of Array.from(r.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        if (el.localName === 'fldChar') {
          tracker.advanceFieldChar(el.getAttribute('w:fldCharType'));
          continue;
        }
        if (tracker.isInsideFieldCode()) continue;
        if (el.localName === 't') p2VisibleChars += (el.textContent ?? '').length;
      }
    }

    expect(tracker.depth).toBe(0);
    expect(p2VisibleChars).toBe('Evaluated True'.length);
  });
});

test(
  'read_file handles nested fields, optional separators, and fields spanning paragraphs',
  async ({ given, when, then }: AllureBddContext) => {
    let session!: Awaited<ReturnType<typeof openSession>>;

    registerCleanup();

    await given('a document with nested fields, spanning fields, and optional separators', async () => {
      const bodyXml =
        // Spanning field: starts in p1, ends in p2
        '<w:p w14:paraId="PARA0001">' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> IF 1 = 1 </w:instrText></w:r>' +
        '</w:p>' +
        '<w:p w14:paraId="PARA0002">' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>TrueResult</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:p>' +
        // Nested field inside a paragraph
        '<w:p w14:paraId="PARA0003">' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> IF </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> = 1 "First" "Other" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>First</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:p>' +
        // Optional separator field (e.g. PAGE with no separate) followed by normal text
        '<w:p w14:paraId="PARA0004">' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t>Normal trailing text</w:t></w:r>' +
        '</w:p>';

      const zipXml = makeDocxZipXml(bodyXml);
      session = await openSession([], { xml: zipXml });
    });

    await when('read_file reads the document in json format', async () => {
      const response = await readFile(session.mgr, { file_path: session.inputPath, format: 'json' });
      assertSuccess(response);
      const nodes = JSON.parse(String(response.content));
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
    });

    await then('read_file reads the document in simple format and excludes instruction text', async () => {
      const response = await readFile(session.mgr, { file_path: session.inputPath, format: 'simple' });
      assertSuccess(response);
      const text = String(response.content);
      expect(text).not.toContain('IF 1 = 1');
      expect(text).not.toContain('PAGE');
      expect(text).toContain('Normal trailing text');
    });
  },
);
