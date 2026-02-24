import { describe, expect } from 'vitest';
import { itAllure as it } from './helpers/allure-test.js';
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

describe('validate_document', () => {
  describe('clean documents', () => {
    it('returns no warnings for a well-formed document', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
        '<w:r><w:t>Hello</w:t></w:r>' +
        '<w:bookmarkEnd w:id="0"/>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns no warnings for empty body', () => {
      const doc = makeDoc('');
      const result = validateDocument(doc);
      expect(result.isValid).toBe(true);
    });

    it('returns valid for document with no body', () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"/>`;
      const doc = parseXml(xml);
      const result = validateDocument(doc);
      expect(result.isValid).toBe(true);
    });
  });

  describe('orphaned bookmarks', () => {
    it('detects bookmarkStart without matching bookmarkEnd', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:bookmarkStart w:id="0" w:name="orphan_start"/>' +
        '<w:r><w:t>Text</w:t></w:r>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe('ORPHANED_BOOKMARK_START');
      expect(result.warnings[0].message).toContain('orphan_start');
    });

    it('detects bookmarkEnd without matching bookmarkStart', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Text</w:t></w:r>' +
        '<w:bookmarkEnd w:id="99"/>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe('ORPHANED_BOOKMARK_END');
    });

    it('does not flag matched bookmark pairs', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:bookmarkStart w:id="1" w:name="a"/>' +
        '<w:bookmarkStart w:id="2" w:name="b"/>' +
        '<w:r><w:t>Text</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/>' +
        '<w:bookmarkEnd w:id="2"/>' +
        '</w:p>',
      );

      const result = validateDocument(doc);
      expect(result.isValid).toBe(true);
    });
  });

  describe('malformed tracked-change wrappers', () => {
    it('detects w:ins missing w:author attribute', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Inserted</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      const malformed = result.warnings.filter(w => w.code === 'MALFORMED_TRACKED_CHANGE');
      expect(malformed.length).toBeGreaterThanOrEqual(1);
      expect(malformed[0].message).toContain('w:author');
    });

    it('detects w:del missing w:date attribute', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:del w:id="1" w:author="A">' +
        '<w:r><w:t>Deleted</w:t></w:r>' +
        '</w:del>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      const malformed = result.warnings.filter(w => w.code === 'MALFORMED_TRACKED_CHANGE');
      expect(malformed.length).toBeGreaterThanOrEqual(1);
      expect(malformed[0].message).toContain('w:date');
    });

    it('detects empty tracked-change wrapper', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z"/>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      const empty = result.warnings.filter(w => w.code === 'EMPTY_TRACKED_CHANGE');
      expect(empty).toHaveLength(1);
    });

    it('does not flag well-formed tracked-change wrappers', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Good</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      const tcWarnings = result.warnings.filter(
        w => w.code === 'MALFORMED_TRACKED_CHANGE' || w.code === 'EMPTY_TRACKED_CHANGE',
      );
      expect(tcWarnings).toHaveLength(0);
    });

    it('accepts well-formed moveFrom/moveTo wrappers', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:moveFrom w:id="10" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Old</w:t></w:r>' +
        '</w:moveFrom>' +
        '<w:moveTo w:id="11" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>New</w:t></w:r>' +
        '</w:moveTo>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      const tcWarnings = result.warnings.filter(
        w => w.code === 'MALFORMED_TRACKED_CHANGE' || w.code === 'EMPTY_TRACKED_CHANGE',
      );
      expect(tcWarnings).toHaveLength(0);
    });
  });

  describe('field marker balance', () => {
    it('detects unmatched fldChar begin', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      const field = result.warnings.filter(w => w.code === 'UNMATCHED_FIELD_BEGIN');
      expect(field).toHaveLength(1);
    });

    it('detects unmatched fldChar end', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      expect(result.isValid).toBe(false);
      const field = result.warnings.filter(w => w.code === 'UNMATCHED_FIELD_END');
      expect(field).toHaveLength(1);
    });

    it('does not flag balanced field markers', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:p>',
      );

      const result = validateDocument(doc);

      const fieldWarnings = result.warnings.filter(
        w => w.code === 'UNMATCHED_FIELD_BEGIN' || w.code === 'UNMATCHED_FIELD_END',
      );
      expect(fieldWarnings).toHaveLength(0);
    });
  });
});
