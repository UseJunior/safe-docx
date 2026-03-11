import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { validateDocument } from '../src/primitives/validate_document.js';

const W_NS = OOXML.W_NS;

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Document Validation' });

describe('validate_document', () => {
  describe('clean documents', () => {
    test('returns no warnings for a well-formed document', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a well-formed document with matched bookmark and a run', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
          '<w:r><w:t>Hello</w:t></w:r>' +
          '<w:bookmarkEnd w:id="0"/>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('the result is valid', () => {
        expect(result.isValid).toBe(true);
      });
      await and('no warnings are reported', () => {
        expect(result.warnings).toHaveLength(0);
      });
    });

    test('returns no warnings for empty body', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a document with an empty body', async () => {
        doc = makeDoc('');
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('the result is valid', () => {
        expect(result.isValid).toBe(true);
      });
    });

    test('returns valid for document with no body', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a document element with no w:body child', async () => {
        const xml =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="${W_NS}"/>`;
        doc = parseXml(xml);
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('the result is valid', () => {
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('orphaned bookmarks', () => {
    test('detects bookmarkStart without matching bookmarkEnd', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a document with a bookmarkStart id=0 but no matching bookmarkEnd', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:bookmarkStart w:id="0" w:name="orphan_start"/>' +
          '<w:r><w:t>Text</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('the result is invalid', () => {
        expect(result.isValid).toBe(false);
      });
      await and('one ORPHANED_BOOKMARK_START warning is reported naming the bookmark', () => {
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].code).toBe('ORPHANED_BOOKMARK_START');
        expect(result.warnings[0].message).toContain('orphan_start');
      });
    });

    test('detects bookmarkEnd without matching bookmarkStart', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a document with a bookmarkEnd id=99 but no matching bookmarkStart', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Text</w:t></w:r>' +
          '<w:bookmarkEnd w:id="99"/>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('the result is invalid', () => {
        expect(result.isValid).toBe(false);
      });
      await and('an ORPHANED_BOOKMARK_END warning is reported', () => {
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].code).toBe('ORPHANED_BOOKMARK_END');
      });
    });

    test('does not flag matched bookmark pairs', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a document with two bookmarkStart/bookmarkEnd pairs both matched', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:bookmarkStart w:id="1" w:name="a"/>' +
          '<w:bookmarkStart w:id="2" w:name="b"/>' +
          '<w:r><w:t>Text</w:t></w:r>' +
          '<w:bookmarkEnd w:id="1"/>' +
          '<w:bookmarkEnd w:id="2"/>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('the result is valid with no warnings', () => {
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('malformed tracked-change wrappers', () => {
    test('detects w:ins missing w:author attribute', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a w:ins element with id and date but no w:author', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Inserted</w:t></w:r>' +
          '</w:ins>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('a MALFORMED_TRACKED_CHANGE warning mentions w:author', () => {
        expect(result.isValid).toBe(false);
        const malformed = result.warnings.filter(w => w.code === 'MALFORMED_TRACKED_CHANGE');
        expect(malformed.length).toBeGreaterThanOrEqual(1);
        expect(malformed[0].message).toContain('w:author');
      });
    });

    test('detects w:del missing w:date attribute', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a w:del element with id and author but no w:date', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:del w:id="1" w:author="A">' +
          '<w:r><w:t>Deleted</w:t></w:r>' +
          '</w:del>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('a MALFORMED_TRACKED_CHANGE warning mentions w:date', () => {
        expect(result.isValid).toBe(false);
        const malformed = result.warnings.filter(w => w.code === 'MALFORMED_TRACKED_CHANGE');
        expect(malformed.length).toBeGreaterThanOrEqual(1);
        expect(malformed[0].message).toContain('w:date');
      });
    });

    test('detects empty tracked-change wrapper', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a self-closing w:ins with all required attributes but no children', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z"/>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('one EMPTY_TRACKED_CHANGE warning is reported', () => {
        expect(result.isValid).toBe(false);
        const empty = result.warnings.filter(w => w.code === 'EMPTY_TRACKED_CHANGE');
        expect(empty).toHaveLength(1);
      });
    });

    test('does not flag well-formed tracked-change wrappers', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a w:ins with all required attributes and a child run', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Good</w:t></w:r>' +
          '</w:ins>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('no tracked-change warnings are reported', () => {
        const tcWarnings = result.warnings.filter(
          w => w.code === 'MALFORMED_TRACKED_CHANGE' || w.code === 'EMPTY_TRACKED_CHANGE',
        );
        expect(tcWarnings).toHaveLength(0);
      });
    });

    test('accepts well-formed moveFrom/moveTo wrappers', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a paragraph with valid moveFrom and moveTo elements', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:moveFrom w:id="10" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Old</w:t></w:r>' +
          '</w:moveFrom>' +
          '<w:moveTo w:id="11" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>New</w:t></w:r>' +
          '</w:moveTo>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('no tracked-change warnings are reported', () => {
        const tcWarnings = result.warnings.filter(
          w => w.code === 'MALFORMED_TRACKED_CHANGE' || w.code === 'EMPTY_TRACKED_CHANGE',
        );
        expect(tcWarnings).toHaveLength(0);
      });
    });
  });

  describe('field marker balance', () => {
    test('detects unmatched fldChar begin', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a paragraph with a fldChar begin and instrText but no end', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('one UNMATCHED_FIELD_BEGIN warning is reported', () => {
        expect(result.isValid).toBe(false);
        const field = result.warnings.filter(w => w.code === 'UNMATCHED_FIELD_BEGIN');
        expect(field).toHaveLength(1);
      });
    });

    test('detects unmatched fldChar end', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a paragraph with a fldChar end but no preceding begin', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('one UNMATCHED_FIELD_END warning is reported', () => {
        expect(result.isValid).toBe(false);
        const field = result.warnings.filter(w => w.code === 'UNMATCHED_FIELD_END');
        expect(field).toHaveLength(1);
      });
    });

    test('does not flag balanced field markers', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof validateDocument>;
      await given('a paragraph with a complete begin/separate/end field sequence', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          '<w:r><w:t>1</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '</w:p>',
        );
      });
      await when('validateDocument is called', async () => {
        result = validateDocument(doc);
      });
      await then('no field-marker warnings are reported', () => {
        const fieldWarnings = result.warnings.filter(
          w => w.code === 'UNMATCHED_FIELD_BEGIN' || w.code === 'UNMATCHED_FIELD_END',
        );
        expect(fieldWarnings).toHaveLength(0);
      });
    });
  });
});
