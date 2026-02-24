import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextContent,
  extractTextWithParagraphs,
  normalizeText,
  compareTexts,
} from './trackChangesAcceptorAst.js';
import { parseDocumentXml } from './xmlToWmlElement.js';
import { findAllByTagName } from '../../primitives/index.js';

describe('trackChangesAcceptorAst', () => {
  describe('acceptAllChanges', () => {
    it('should remove w:del elements entirely', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r>
                <w:t>Hello </w:t>
              </w:r>
              <w:del w:id="1" w:author="Test">
                <w:r>
                  <w:delText>old </w:delText>
                </w:r>
              </w:del>
              <w:r>
                <w:t>World</w:t>
              </w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = acceptAllChanges(input);

      expect(result).not.toContain('w:del');
      expect(result).not.toContain('old');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('should unwrap w:ins elements but keep content', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r>
                <w:t>Hello </w:t>
              </w:r>
              <w:ins w:id="1" w:author="Test">
                <w:r>
                  <w:t>new </w:t>
                </w:r>
              </w:ins>
              <w:r>
                <w:t>World</w:t>
              </w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = acceptAllChanges(input);

      expect(result).not.toContain('w:ins');
      expect(result).toContain('new');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('should handle nested w:ins and w:del', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:ins w:id="1">
                <w:r>
                  <w:t>inserted </w:t>
                </w:r>
                <w:del w:id="2">
                  <w:r>
                    <w:delText>nested-deleted</w:delText>
                  </w:r>
                </w:del>
              </w:ins>
            </w:p>
          </w:body>
        </w:document>`;

      const result = acceptAllChanges(input);

      expect(result).not.toContain('w:ins');
      expect(result).not.toContain('w:del');
      expect(result).toContain('inserted');
      expect(result).not.toContain('nested-deleted');
    });

    it('should remove rPrChange elements', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r>
                <w:rPr>
                  <w:b/>
                  <w:rPrChange w:id="1" w:author="Test">
                    <w:rPr/>
                  </w:rPrChange>
                </w:rPr>
                <w:t>Bold text</w:t>
              </w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = acceptAllChanges(input);

      expect(result).not.toContain('w:rPrChange');
      expect(result).toContain('w:b');
      expect(result).toContain('Bold text');
    });

    it('should remove move range markers', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:moveFromRangeStart w:id="1" w:name="move1"/>
              <w:moveFrom w:id="1">
                <w:r><w:t>moved</w:t></w:r>
              </w:moveFrom>
              <w:moveFromRangeEnd w:id="1"/>
            </w:p>
            <w:p>
              <w:moveToRangeStart w:id="2" w:name="move1"/>
              <w:moveTo w:id="2">
                <w:r><w:t>moved</w:t></w:r>
              </w:moveTo>
              <w:moveToRangeEnd w:id="2"/>
            </w:p>
          </w:body>
        </w:document>`;

      const result = acceptAllChanges(input);

      // Accept: remove moveFrom, unwrap moveTo
      expect(result).not.toContain('w:moveFrom');
      expect(result).not.toContain('w:moveTo');
      expect(result).not.toContain('w:moveFromRangeStart');
      expect(result).not.toContain('w:moveFromRangeEnd');
      expect(result).not.toContain('w:moveToRangeStart');
      expect(result).not.toContain('w:moveToRangeEnd');
      // Content from moveTo should remain
      expect(result).toContain('moved');
    });
  });

  describe('rejectAllChanges', () => {
    it('should remove w:ins elements entirely', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r>
                <w:t>Hello </w:t>
              </w:r>
              <w:ins w:id="1" w:author="Test">
                <w:r>
                  <w:t>new </w:t>
                </w:r>
              </w:ins>
              <w:r>
                <w:t>World</w:t>
              </w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);

      expect(result).not.toContain('w:ins');
      expect(result).not.toContain('new');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('should unwrap w:del elements and convert w:delText to w:t', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r>
                <w:t>Hello </w:t>
              </w:r>
              <w:del w:id="1" w:author="Test">
                <w:r>
                  <w:delText>old </w:delText>
                </w:r>
              </w:del>
              <w:r>
                <w:t>World</w:t>
              </w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);

      expect(result).not.toContain('w:del');
      expect(result).not.toContain('w:delText');
      expect(result).toContain('<w:t>old </w:t>');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('should handle nested structures correctly', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:del w:id="1">
                <w:r>
                  <w:delText>deleted </w:delText>
                </w:r>
                <w:ins w:id="2">
                  <w:r>
                    <w:t>nested-inserted</w:t>
                  </w:r>
                </w:ins>
              </w:del>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);

      expect(result).not.toContain('w:del');
      expect(result).not.toContain('w:ins');
      expect(result).toContain('deleted');
      // nested-inserted is removed because it's inside ins which is removed
      // before del is unwrapped
      expect(result).not.toContain('nested-inserted');
    });

    it('should handle move operations', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:moveFrom w:id="1">
                <w:r><w:t>moved content</w:t></w:r>
              </w:moveFrom>
            </w:p>
            <w:p>
              <w:moveTo w:id="2">
                <w:r><w:t>moved content</w:t></w:r>
              </w:moveTo>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);

      // Reject: unwrap moveFrom, remove moveTo
      expect(result).not.toContain('w:moveFrom');
      expect(result).not.toContain('w:moveTo');
      // Content from moveFrom should remain (original position)
      // Count occurrences - should only appear once (from moveFrom, not moveTo)
      const matches = result.match(/moved content/g);
      expect(matches).toHaveLength(1);
    });

    it('preserves bookmarkStart when inserted paragraph is removed but bookmarkEnd is retained', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:pPr>
                <w:rPr><w:ins w:id="1"/></w:rPr>
              </w:pPr>
              <w:bookmarkStart w:id="700" w:name="_RefKeepStart"/>
              <w:ins w:id="2"><w:r><w:t>Inserted paragraph content</w:t></w:r></w:ins>
            </w:p>
            <w:p>
              <w:r><w:t>Retained paragraph</w:t></w:r>
              <w:bookmarkEnd w:id="700"/>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);
      const root = parseDocumentXml(result);
      const starts = findAllByTagName(root, 'w:bookmarkStart');
      const ends = findAllByTagName(root, 'w:bookmarkEnd');
      const startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const startNames = starts
        .map((n) => n.getAttribute('w:name'))
        .filter((name): name is string => Boolean(name));

      expect(result).not.toContain('Inserted paragraph content');
      expect(startIds).toContain('700');
      expect(endIds).toContain('700');
      expect(startNames).toContain('_RefKeepStart');
    });

    it('preserves bookmarkEnd when inserted paragraph is removed but bookmarkStart is retained', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:bookmarkStart w:id="701" w:name="_RefKeepEnd"/>
              <w:r><w:t>Retained paragraph</w:t></w:r>
            </w:p>
            <w:p>
              <w:pPr>
                <w:rPr><w:ins w:id="3"/></w:rPr>
              </w:pPr>
              <w:ins w:id="4"><w:r><w:t>Inserted paragraph content</w:t></w:r></w:ins>
              <w:bookmarkEnd w:id="701"/>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);
      const root = parseDocumentXml(result);
      const starts = findAllByTagName(root, 'w:bookmarkStart');
      const ends = findAllByTagName(root, 'w:bookmarkEnd');
      const startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const startNames = starts
        .map((n) => n.getAttribute('w:name'))
        .filter((name): name is string => Boolean(name));

      expect(result).not.toContain('Inserted paragraph content');
      expect(startIds).toContain('701');
      expect(endIds).toContain('701');
      expect(startNames).toContain('_RefKeepEnd');
    });

    it('does not preserve bookmarks that are fully contained within removed inserted paragraphs', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>Retained paragraph</w:t></w:r>
            </w:p>
            <w:p>
              <w:pPr>
                <w:rPr><w:ins w:id="5"/></w:rPr>
              </w:pPr>
              <w:bookmarkStart w:id="702" w:name="_RefInsertedOnly"/>
              <w:ins w:id="6"><w:r><w:t>Inserted-only content</w:t></w:r></w:ins>
              <w:bookmarkEnd w:id="702"/>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);
      const root = parseDocumentXml(result);
      const starts = findAllByTagName(root, 'w:bookmarkStart');
      const ends = findAllByTagName(root, 'w:bookmarkEnd');
      const startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const startNames = starts
        .map((n) => n.getAttribute('w:name'))
        .filter((name): name is string => Boolean(name));

      expect(result).not.toContain('Inserted-only content');
      expect(startIds).not.toContain('702');
      expect(endIds).not.toContain('702');
      expect(startNames).not.toContain('_RefInsertedOnly');
    });

    it('preserves fully-contained removed bookmarks when surviving field codes still reference them', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>Retained paragraph with field: </w:t></w:r>
              <w:r><w:instrText xml:space="preserve"> REF _RefKeepReferenced \\h </w:instrText></w:r>
            </w:p>
            <w:p>
              <w:pPr>
                <w:rPr><w:ins w:id="7"/></w:rPr>
              </w:pPr>
              <w:bookmarkStart w:id="703" w:name="_RefKeepReferenced"/>
              <w:ins w:id="8"><w:r><w:t>Inserted-only content</w:t></w:r></w:ins>
              <w:bookmarkEnd w:id="703"/>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);
      const root = parseDocumentXml(result);
      const starts = findAllByTagName(root, 'w:bookmarkStart');
      const ends = findAllByTagName(root, 'w:bookmarkEnd');
      const startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
      const startNames = starts
        .map((n) => n.getAttribute('w:name'))
        .filter((name): name is string => Boolean(name));

      expect(result).not.toContain('Inserted-only content');
      expect(startIds).toContain('703');
      expect(endIds).toContain('703');
      expect(startNames).toContain('_RefKeepReferenced');
    });

    it('does not duplicate bookmark boundaries when removed paragraphs already have surviving counterparts', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:bookmarkStart w:id="800" w:name="_RefDup"/>
              <w:r><w:t>Retained bookmark owner</w:t></w:r>
              <w:bookmarkEnd w:id="800"/>
              <w:r><w:instrText xml:space="preserve"> REF _RefDup \\h </w:instrText></w:r>
            </w:p>
            <w:p>
              <w:pPr>
                <w:rPr><w:ins w:id="9"/></w:rPr>
              </w:pPr>
              <w:bookmarkStart w:id="800" w:name="_RefDup"/>
              <w:ins w:id="10"><w:r><w:t>Inserted duplicate bookmark owner</w:t></w:r></w:ins>
              <w:bookmarkEnd w:id="800"/>
            </w:p>
          </w:body>
        </w:document>`;

      const result = rejectAllChanges(input);
      const root = parseDocumentXml(result);
      const starts = findAllByTagName(root, 'w:bookmarkStart')
        .filter((n) => n.getAttribute('w:id') === '800');
      const ends = findAllByTagName(root, 'w:bookmarkEnd')
        .filter((n) => n.getAttribute('w:id') === '800');

      expect(result).not.toContain('Inserted duplicate bookmark owner');
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
    });
  });

  describe('extractTextContent', () => {
    it('should extract text from w:t elements', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>Hello </w:t></w:r>
              <w:r><w:t>World</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = extractTextContent(input);

      expect(result).toBe('Hello World');
    });

    it('should include w:delText content', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>Hello </w:t></w:r>
              <w:del><w:r><w:delText>deleted </w:delText></w:r></w:del>
              <w:r><w:t>World</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>`;

      const result = extractTextContent(input);

      // Note: w:t elements are collected first, then w:delText
      expect(result).toContain('Hello');
      expect(result).toContain('World');
      expect(result).toContain('deleted');
    });
  });

  describe('extractTextWithParagraphs', () => {
    it('should separate paragraphs with newlines', () => {
      const input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
            <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
          </w:body>
        </w:document>`;

      const result = extractTextWithParagraphs(input);

      expect(result).toBe('First paragraph\nSecond paragraph');
    });
  });

  describe('normalizeText', () => {
    it('should normalize CRLF to LF', () => {
      expect(normalizeText('a\r\nb')).toBe('a\nb');
    });

    it('should normalize CR to LF', () => {
      expect(normalizeText('a\rb')).toBe('a\nb');
    });

    it('should convert tabs to spaces', () => {
      expect(normalizeText('a\tb')).toBe('a b');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeText('a   b')).toBe('a b');
    });

    it('should strip trailing spaces from lines', () => {
      expect(normalizeText('a  \nb')).toBe('a\nb');
    });

    it('should strip leading spaces from lines', () => {
      expect(normalizeText('a\n  b')).toBe('a\nb');
    });

    it('should collapse multiple newlines', () => {
      expect(normalizeText('a\n\n\nb')).toBe('a\nb');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(normalizeText('  hello  ')).toBe('hello');
    });
  });

  describe('compareTexts', () => {
    it('should report identical texts', () => {
      const result = compareTexts('hello', 'hello');

      expect(result.identical).toBe(true);
      expect(result.normalizedIdentical).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it('should report different texts', () => {
      const result = compareTexts('hello', 'world');

      expect(result.identical).toBe(false);
      expect(result.differences.length).toBeGreaterThan(0);
    });

    it('should handle whitespace differences', () => {
      const result = compareTexts('hello  world', 'hello world');

      expect(result.identical).toBe(false);
      expect(result.normalizedIdentical).toBe(true);
    });

    it('should report lengths', () => {
      const result = compareTexts('abc', 'abcd');

      expect(result.expectedLength).toBe(3);
      expect(result.actualLength).toBe(4);
    });
  });
});
