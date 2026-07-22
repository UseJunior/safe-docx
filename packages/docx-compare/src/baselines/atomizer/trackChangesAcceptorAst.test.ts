import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextContent,
  extractTextWithParagraphs,
  normalizeText,
  compareTexts,
} from './trackChangesAcceptorAst.js';
import { parseDocumentXml } from './xmlToWmlElement.js';
import {
  findAllByTagName,
  acceptChanges as acceptChangesPrimitive,
  rejectChanges as rejectChangesPrimitive,
  parseXml,
  serializeXml,
} from '@usejunior/docx-core';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Track Changes Acceptor' });

describe('trackChangesAcceptorAst', () => {
  describe('acceptAllChanges', () => {
    test('should remove w:del elements entirely', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with a w:del element containing deleted text', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('acceptAllChanges is called', () => {
        result = acceptAllChanges(input);
      });

      await then('the result does not contain w:del', () => {
        expect(result).not.toContain('w:del');
      });

      await and('the deleted text is removed', () => {
        expect(result).not.toContain('old');
      });

      await and('the retained text is preserved', () => {
        expect(result).toContain('Hello');
        expect(result).toContain('World');
      });
    });

    test('should unwrap w:ins elements but keep content', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with a w:ins element containing inserted text', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('acceptAllChanges is called', () => {
        result = acceptAllChanges(input);
      });

      await then('the result does not contain w:ins wrapper', () => {
        expect(result).not.toContain('w:ins');
      });

      await and('the inserted content is preserved', () => {
        expect(result).toContain('new');
        expect(result).toContain('Hello');
        expect(result).toContain('World');
      });
    });

    test('should handle nested w:ins and w:del', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with nested w:ins containing a w:del', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('acceptAllChanges is called', () => {
        result = acceptAllChanges(input);
      });

      await then('w:ins and w:del wrappers are removed', () => {
        expect(result).not.toContain('w:ins');
        expect(result).not.toContain('w:del');
      });

      await and('the inserted text is kept but nested-deleted text is removed', () => {
        expect(result).toContain('inserted');
        expect(result).not.toContain('nested-deleted');
      });
    });

    test('should remove rPrChange elements', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with a run containing w:rPrChange', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('acceptAllChanges is called', () => {
        result = acceptAllChanges(input);
      });

      await then('w:rPrChange is removed', () => {
        expect(result).not.toContain('w:rPrChange');
      });

      await and('the bold formatting and text are preserved', () => {
        expect(result).toContain('w:b');
        expect(result).toContain('Bold text');
      });
    });

    test('should remove move range markers', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with move range markers', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('acceptAllChanges is called', () => {
        result = acceptAllChanges(input);
      });

      await then('all move range elements are removed', () => {
        // Accept: remove moveFrom, unwrap moveTo
        expect(result).not.toContain('w:moveFrom');
        expect(result).not.toContain('w:moveTo');
        expect(result).not.toContain('w:moveFromRangeStart');
        expect(result).not.toContain('w:moveFromRangeEnd');
        expect(result).not.toContain('w:moveToRangeStart');
        expect(result).not.toContain('w:moveToRangeEnd');
      });

      await and('content from moveTo is retained', () => {
        expect(result).toContain('moved');
      });
    });
  });

  describe('rejectAllChanges', () => {
    test('should remove w:ins elements entirely', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with a w:ins element containing inserted text', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
      });

      await then('w:ins and its content are removed', () => {
        expect(result).not.toContain('w:ins');
        expect(result).not.toContain('new');
      });

      await and('the retained text is preserved', () => {
        expect(result).toContain('Hello');
        expect(result).toContain('World');
      });
    });

    test('should unwrap w:del elements and convert w:delText to w:t', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with a w:del element containing w:delText', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
      });

      await then('w:del wrapper and w:delText are removed', () => {
        expect(result).not.toContain('w:del');
        expect(result).not.toContain('w:delText');
      });

      await and('deleted text is restored as w:t', () => {
        expect(result).toContain('<w:t>old </w:t>');
        expect(result).toContain('Hello');
        expect(result).toContain('World');
      });
    });

    test('should handle nested structures correctly', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with a w:del containing a nested w:ins', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
      });

      await then('w:del and w:ins wrappers are removed', () => {
        expect(result).not.toContain('w:del');
        expect(result).not.toContain('w:ins');
      });

      await and('deleted text is restored and nested-inserted is removed', () => {
        expect(result).toContain('deleted');
        // nested-inserted is removed because it's inside ins which is removed
        // before del is unwrapped
        expect(result).not.toContain('nested-inserted');
      });
    });

    test('should handle move operations', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with moveFrom and moveTo elements', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
      });

      await then('move range elements are removed', () => {
        // Reject: unwrap moveFrom, remove moveTo
        expect(result).not.toContain('w:moveFrom');
        expect(result).not.toContain('w:moveTo');
      });

      await and('content from moveFrom appears exactly once', () => {
        // Content from moveFrom should remain (original position)
        // Count occurrences - should only appear once (from moveFrom, not moveTo)
        const matches = result.match(/moved content/g);
        expect(matches).toHaveLength(1);
      });
    });

    test('preserves bookmarkStart when inserted paragraph is removed but bookmarkEnd is retained', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;
      let startIds: string[];
      let endIds: string[];
      let startNames: string[];

      await given('a document where bookmarkStart is in a removed inserted paragraph but bookmarkEnd is in a retained paragraph', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
        const root = parseDocumentXml(result);
        const starts = findAllByTagName(root, 'w:bookmarkStart');
        const ends = findAllByTagName(root, 'w:bookmarkEnd');
        startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        startNames = starts
          .map((n) => n.getAttribute('w:name'))
          .filter((name): name is string => Boolean(name));
      });

      await then('inserted paragraph content is removed', () => {
        expect(result).not.toContain('Inserted paragraph content');
      });

      await and('bookmarkStart with id 700 is preserved', () => {
        expect(startIds).toContain('700');
      });

      await and('bookmarkEnd with id 700 is preserved', () => {
        expect(endIds).toContain('700');
      });

      await and('bookmarkStart name _RefKeepStart is preserved', () => {
        expect(startNames).toContain('_RefKeepStart');
      });
    });

    test('preserves bookmarkEnd when inserted paragraph is removed but bookmarkStart is retained', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;
      let startIds: string[];
      let endIds: string[];
      let startNames: string[];

      await given('a document where bookmarkEnd is in a removed inserted paragraph but bookmarkStart is in a retained paragraph', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
        const root = parseDocumentXml(result);
        const starts = findAllByTagName(root, 'w:bookmarkStart');
        const ends = findAllByTagName(root, 'w:bookmarkEnd');
        startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        startNames = starts
          .map((n) => n.getAttribute('w:name'))
          .filter((name): name is string => Boolean(name));
      });

      await then('inserted paragraph content is removed', () => {
        expect(result).not.toContain('Inserted paragraph content');
      });

      await and('bookmarkStart with id 701 is preserved', () => {
        expect(startIds).toContain('701');
      });

      await and('bookmarkEnd with id 701 is preserved', () => {
        expect(endIds).toContain('701');
      });

      await and('bookmarkStart name _RefKeepEnd is preserved', () => {
        expect(startNames).toContain('_RefKeepEnd');
      });
    });

    test('does not preserve bookmarks that are fully contained within removed inserted paragraphs', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;
      let startIds: string[];
      let endIds: string[];
      let startNames: string[];

      await given('a document where both bookmarkStart and bookmarkEnd are in a removed inserted paragraph', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
        const root = parseDocumentXml(result);
        const starts = findAllByTagName(root, 'w:bookmarkStart');
        const ends = findAllByTagName(root, 'w:bookmarkEnd');
        startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        startNames = starts
          .map((n) => n.getAttribute('w:name'))
          .filter((name): name is string => Boolean(name));
      });

      await then('inserted-only content is removed', () => {
        expect(result).not.toContain('Inserted-only content');
      });

      await and('bookmarkStart and bookmarkEnd with id 702 are not preserved', () => {
        expect(startIds).not.toContain('702');
        expect(endIds).not.toContain('702');
        expect(startNames).not.toContain('_RefInsertedOnly');
      });
    });

    test('preserves fully-contained removed bookmarks when surviving field codes still reference them', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;
      let startIds: string[];
      let endIds: string[];
      let startNames: string[];

      await given('a document where a bookmark in a removed inserted paragraph is still referenced by a surviving field code', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
        const root = parseDocumentXml(result);
        const starts = findAllByTagName(root, 'w:bookmarkStart');
        const ends = findAllByTagName(root, 'w:bookmarkEnd');
        startIds = starts.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        endIds = ends.map((n) => n.getAttribute('w:id')).filter((id): id is string => Boolean(id));
        startNames = starts
          .map((n) => n.getAttribute('w:name'))
          .filter((name): name is string => Boolean(name));
      });

      await then('inserted-only content is removed', () => {
        expect(result).not.toContain('Inserted-only content');
      });

      await and('the referenced bookmark is preserved', () => {
        expect(startIds).toContain('703');
        expect(endIds).toContain('703');
        expect(startNames).toContain('_RefKeepReferenced');
      });
    });

    test('does not duplicate bookmark boundaries when removed paragraphs already have surviving counterparts', async ({ given, when, then, and }: AllureBddContext) => {
      let input: string;
      let result: string;
      let starts: Element[];
      let ends: Element[];

      await given('a document where a bookmark exists in both a retained and a removed inserted paragraph', () => {
        input = `<?xml version="1.0"?>
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
      });

      await when('rejectAllChanges is called', () => {
        result = rejectAllChanges(input);
        const root = parseDocumentXml(result);
        starts = findAllByTagName(root, 'w:bookmarkStart')
          .filter((n) => n.getAttribute('w:id') === '800');
        ends = findAllByTagName(root, 'w:bookmarkEnd')
          .filter((n) => n.getAttribute('w:id') === '800');
      });

      await then('the inserted duplicate bookmark owner is removed', () => {
        expect(result).not.toContain('Inserted duplicate bookmark owner');
      });

      await and('the bookmark boundary appears exactly once', () => {
        expect(starts).toHaveLength(1);
        expect(ends).toHaveLength(1);
      });
    });
  });

  describe('extractTextContent', () => {
    test('should extract text from w:t elements', async ({ given, when, then }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with w:t elements', () => {
        input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>Hello </w:t></w:r>
              <w:r><w:t>World</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>`;
      });

      await when('extractTextContent is called', () => {
        result = extractTextContent(input);
      });

      await then('the text content is concatenated', () => {
        expect(result).toBe('Hello World');
      });
    });

    test('should include w:delText content', async ({ given, when, then }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with w:t and w:delText elements', () => {
        input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>Hello </w:t></w:r>
              <w:del><w:r><w:delText>deleted </w:delText></w:r></w:del>
              <w:r><w:t>World</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>`;
      });

      await when('extractTextContent is called', () => {
        result = extractTextContent(input);
      });

      await then('all text including w:delText is included', () => {
        // Note: w:t elements are collected first, then w:delText
        expect(result).toContain('Hello');
        expect(result).toContain('World');
        expect(result).toContain('deleted');
      });
    });
  });

  describe('extractTextWithParagraphs', () => {
    test('should separate paragraphs with newlines', async ({ given, when, then }: AllureBddContext) => {
      let input: string;
      let result: string;

      await given('a document with two paragraphs', () => {
        input = `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
            <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
          </w:body>
        </w:document>`;
      });

      await when('extractTextWithParagraphs is called', () => {
        result = extractTextWithParagraphs(input);
      });

      await then('paragraphs are separated by newlines', () => {
        expect(result).toBe('First paragraph\nSecond paragraph');
      });
    });
  });

  describe('normalizeText', () => {
    test('should normalize CRLF to LF', async ({ given, when, then }: AllureBddContext) => {
      await given('text with CRLF line endings', () => {});
      await when('normalizeText is called', () => {});
      await then('CRLF is converted to LF', () => {
        expect(normalizeText('a\r\nb')).toBe('a\nb');
      });
    });

    test('should normalize CR to LF', async ({ given, when, then }: AllureBddContext) => {
      await given('text with CR line endings', () => {});
      await when('normalizeText is called', () => {});
      await then('CR is converted to LF', () => {
        expect(normalizeText('a\rb')).toBe('a\nb');
      });
    });

    test('should convert tabs to spaces', async ({ given, when, then }: AllureBddContext) => {
      await given('text with tab characters', () => {});
      await when('normalizeText is called', () => {});
      await then('tabs are converted to spaces', () => {
        expect(normalizeText('a\tb')).toBe('a b');
      });
    });

    test('should collapse multiple spaces', async ({ given, when, then }: AllureBddContext) => {
      await given('text with multiple consecutive spaces', () => {});
      await when('normalizeText is called', () => {});
      await then('multiple spaces are collapsed to one', () => {
        expect(normalizeText('a   b')).toBe('a b');
      });
    });

    test('should strip trailing spaces from lines', async ({ given, when, then }: AllureBddContext) => {
      await given('text with trailing spaces on a line', () => {});
      await when('normalizeText is called', () => {});
      await then('trailing spaces are stripped', () => {
        expect(normalizeText('a  \nb')).toBe('a\nb');
      });
    });

    test('should strip leading spaces from lines', async ({ given, when, then }: AllureBddContext) => {
      await given('text with leading spaces on a line', () => {});
      await when('normalizeText is called', () => {});
      await then('leading spaces are stripped', () => {
        expect(normalizeText('a\n  b')).toBe('a\nb');
      });
    });

    test('should collapse multiple newlines', async ({ given, when, then }: AllureBddContext) => {
      await given('text with multiple consecutive newlines', () => {});
      await when('normalizeText is called', () => {});
      await then('multiple newlines are collapsed to one', () => {
        expect(normalizeText('a\n\n\nb')).toBe('a\nb');
      });
    });

    test('should trim leading and trailing whitespace', async ({ given, when, then }: AllureBddContext) => {
      await given('text with leading and trailing whitespace', () => {});
      await when('normalizeText is called', () => {});
      await then('leading and trailing whitespace is trimmed', () => {
        expect(normalizeText('  hello  ')).toBe('hello');
      });
    });
  });

  describe('compareTexts', () => {
    test('should report identical texts', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof compareTexts>;

      await given('two identical text strings', () => {});

      await when('compareTexts is called', () => {
        result = compareTexts('hello', 'hello');
      });

      await then('the result reports identical with no differences', () => {
        expect(result.identical).toBe(true);
        expect(result.normalizedIdentical).toBe(true);
        expect(result.differences).toHaveLength(0);
      });
    });

    test('should report different texts', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof compareTexts>;

      await given('two different text strings', () => {});

      await when('compareTexts is called', () => {
        result = compareTexts('hello', 'world');
      });

      await then('the result reports not identical with differences', () => {
        expect(result.identical).toBe(false);
        expect(result.differences.length).toBeGreaterThan(0);
      });
    });

    test('should handle whitespace differences', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof compareTexts>;

      await given('two texts that differ only in whitespace', () => {});

      await when('compareTexts is called', () => {
        result = compareTexts('hello  world', 'hello world');
      });

      await then('the result reports not identical but normalizedIdentical', () => {
        expect(result.identical).toBe(false);
        expect(result.normalizedIdentical).toBe(true);
      });
    });

    test('should report lengths', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof compareTexts>;

      await given('two texts of different lengths', () => {});

      await when('compareTexts is called', () => {
        result = compareTexts('abc', 'abcd');
      });

      await then('the result reports correct lengths', () => {
        expect(result.expectedLength).toBe(3);
        expect(result.actualLength).toBe(4);
      });
    });
  });
});

// ── G5 regression: Accept-All paragraph-mark handling is purely mark-based (both accept paths) ──
//
// Closes G5 — the accept-side mirror of #337's reject fix. Both accept entry points — the
// baseline-atomizer `acceptAllChanges` (string→string) and the primitive `acceptChanges`
// (Document, mutated in place) — must resolve a paragraph IFF its paragraph MARK is PPR-DEL
// (<w:pPr><w:rPr><w:del/></w:rPr>), never via a content-based heuristic. A run-level deletion
// (or moveFrom) under an UNTRACKED mark means text removed from a pre-existing paragraph, which
// Word/LibreOffice keep (empty) on accept. Resolving a PPR-DEL mark merges the paragraph into
// the following one (#431) — only the break is deleted, not the contents. The two paths must
// agree on every case.
describe('Accept-All paragraph removal is mark-based (G5, both accept paths agree)', () => {
  const wrapBody = (inner: string): string =>
    `<?xml version="1.0"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${inner}</w:body></w:document>`;

  // Count <w:p> opens, matching self-closing empties (<w:p/>) too; never matches <w:pPr>/<w:pPrChange>.
  const countParagraphs = (xml: string): number => (xml.match(/<w:p(?:\s|\/|>)/g) ?? []).length;

  const KEEP_PARA = `<w:p><w:r><w:t>keep</w:t></w:r></w:p>`;

  // Run a body fragment through BOTH accept entry points (fresh parse for the in-place primitive).
  const acceptBoth = (inner: string): { ast: string; primitive: string } => {
    const ast = acceptAllChanges(wrapBody(inner));
    const doc = parseXml(wrapBody(inner));
    acceptChangesPrimitive(doc);
    return { ast, primitive: serializeXml(doc) };
  };

  test('PPR-DEL-marked paragraph: both paths MERGE it into the following paragraph', async ({ when, then }: AllureBddContext) => {
    // The PPR-DEL mark deletes only the paragraph BREAK (ECMA-376 § 17.13.5.15); the
    // paragraph's untracked content is NOT deleted and must survive the merge (#431).
    let out: { ast: string; primitive: string };
    await when('both accept paths run on a PPR-DEL-marked paragraph with untracked content + a plain paragraph', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="T"/></w:rPr></w:pPr><w:r><w:t>merged</w:t></w:r></w:p>` +
          KEEP_PARA,
      );
    });
    await then('one paragraph remains holding the merged content before the survivor text, on both paths', () => {
      expect(countParagraphs(out.ast)).toBe(1);
      expect(countParagraphs(out.primitive)).toBe(1);
      for (const xml of [out.ast, out.primitive]) {
        expect(xml).toContain('merged');
        expect(xml).toContain('keep');
        expect(xml.indexOf('merged')).toBeLessThan(xml.indexOf('keep'));
      }
    });
  });

  test('del-only paragraph with an untracked mark: both paths KEEP an empty <w:p>', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('both accept paths run on a del-only untracked-mark paragraph + a plain paragraph', () => {
      out = acceptBoth(
        `<w:p><w:del w:id="1" w:author="T"><w:r><w:delText>x</w:delText></w:r></w:del></w:p>` + KEEP_PARA,
      );
    });
    await then('the now-empty paragraph survives, on both paths', () => {
      expect(countParagraphs(out.ast)).toBe(2);
      expect(countParagraphs(out.primitive)).toBe(2);
      expect(out.ast).not.toContain('w:del');
      expect(out.primitive).not.toContain('w:del');
    });
  });

  test('moveFrom-only paragraph with an untracked mark: both paths KEEP an empty <w:p>', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('both accept paths run on a moveFrom-only untracked-mark paragraph + a plain paragraph', () => {
      out = acceptBoth(
        `<w:p><w:moveFrom w:id="1" w:author="T"><w:r><w:t>moved</w:t></w:r></w:moveFrom></w:p>` + KEEP_PARA,
      );
    });
    await then('the now-empty paragraph survives, on both paths', () => {
      expect(countParagraphs(out.ast)).toBe(2);
      expect(countParagraphs(out.primitive)).toBe(2);
      expect(out.ast).not.toContain('w:moveFrom');
      expect(out.primitive).not.toContain('w:moveFrom');
    });
  });

  test('pPrChange snapshot holding a nested w:del is NOT a live mark: both paths KEEP the paragraph', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('both accept paths run on a surviving paragraph whose w:pPrChange snapshot nests a w:del', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr/>` +
          `<w:pPrChange w:id="1" w:author="T"><w:pPr><w:rPr><w:del/></w:rPr></w:pPr></w:pPrChange>` +
          `</w:pPr><w:r><w:t>survives</w:t></w:r></w:p>`,
      );
    });
    await then('the paragraph is kept (the nested snapshot del is ignored), on both paths', () => {
      expect(countParagraphs(out.ast)).toBe(1);
      expect(countParagraphs(out.primitive)).toBe(1);
      expect(out.ast).toContain('survives');
      expect(out.primitive).toContain('survives');
    });
  });
});

// ── #431: a paragraph-mark revision merges the paragraph into the following one ──
//
// ECMA-376 Part 1 § 17.13.5.15 (del / Deleted Paragraph) and § 17.13.5.20 (ins /
// Inserted Paragraph) make the paragraph MARK the revision target; the paragraph's
// contents are not implicitly part of the revision. Accepting a deleted mark (or
// rejecting an inserted one) therefore removes only the paragraph BREAK: the
// paragraph's surviving content merges into the following paragraph, which keeps
// its own w:pPr (formatting follows the surviving mark). Both engine paths — the
// baseline-atomizer string functions and the in-place primitives — must agree.
describe('Paragraph-mark revisions merge into the following paragraph (#431)', () => {
  const acceptTest = testAllure
    .epic('Document Comparison')
    .withLabels({ feature: 'Track Changes Acceptor' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' });
  const rejectTest = testAllure
    .epic('Document Comparison')
    .withLabels({ feature: 'Track Changes Acceptor' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' });

  const wrapBody = (inner: string): string =>
    `<?xml version="1.0"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${inner}</w:body></w:document>`;

  // Count <w:p> opens, matching self-closing empties (<w:p/>) too; never matches <w:pPr>/<w:pPrChange>.
  const countParagraphs = (xml: string): number => (xml.match(/<w:p(?:\s|\/|>)/g) ?? []).length;

  const stripTags = (s: string): string => {
    // Loop until stable so nested/adjacent angle brackets cannot leave a
    // freshly-formed "<...>" behind after a single replace pass.
    let out = s;
    let prev: string;
    do {
      prev = out;
      out = out.replace(/<[^>]+>/g, '');
    } while (out !== prev);
    return out;
  };
  const extractText = (xml: string): string =>
    (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((t) => stripTags(t))
      .join('');

  const acceptBoth = (inner: string): { ast: string; primitive: string } => {
    const ast = acceptAllChanges(wrapBody(inner));
    const doc = parseXml(wrapBody(inner));
    acceptChangesPrimitive(doc);
    return { ast, primitive: serializeXml(doc) };
  };

  const rejectBoth = (inner: string): { ast: string; primitive: string } => {
    const ast = rejectAllChanges(wrapBody(inner));
    const doc = parseXml(wrapBody(inner));
    rejectChangesPrimitive(doc);
    return { ast, primitive: serializeXml(doc) };
  };

  const DEL_MARK = `<w:del w:id="1" w:author="T" w:date="2024-01-01T00:00:00Z"/>`;
  const INS_MARK = `<w:ins w:id="1" w:author="T" w:date="2024-01-01T00:00:00Z"/>`;

  acceptTest('accepting a deleted paragraph mark merges the preceding content into the next paragraph', async ({ when, then }: AllureBddContext) => {
    // The docx-platform-tests acceptDeletedParagraphMarkMergesParagraphs scenario.
    let out: { ast: string; primitive: string };
    await when('accept runs on a mark-deleted paragraph "First half " followed by "second half"', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr><w:r><w:t xml:space="preserve">First half </w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>second half</w:t></w:r></w:p>`,
      );
    });
    await then('one paragraph remains reading "First half second half", on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('First half second half');
      }
    });
  });

  rejectTest('rejecting an inserted paragraph mark merges the preceding content into the next paragraph', async ({ when, then }: AllureBddContext) => {
    // The docx-platform-tests rejectInsertedParagraphMarkMergesParagraphs scenario.
    let out: { ast: string; primitive: string };
    await when('reject runs on a mark-inserted paragraph "First half " followed by "second half"', () => {
      out = rejectBoth(
        `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr></w:pPr><w:r><w:t xml:space="preserve">First half </w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>second half</w:t></w:r></w:p>`,
      );
    });
    await then('one paragraph remains reading "First half second half", on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('First half second half');
      }
    });
  });

  acceptTest('the merged paragraph keeps the FOLLOWING paragraph\'s w:pPr (formatting follows the surviving mark)', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on a centered mark-deleted paragraph followed by a styled paragraph', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr><w:jc w:val="center"/></w:pPr><w:r><w:t>head</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>tail</w:t></w:r></w:p>`,
      );
    });
    await then('the survivor keeps its pStyle and the merged-away paragraph\'s jc is gone, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('headtail');
        expect(xml).toContain('Quote');
        expect(xml).not.toContain('center');
      }
    });
  });

  acceptTest('consecutive mark-deleted paragraphs cascade into the first surviving paragraph', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on two consecutive mark-deleted paragraphs followed by a plain one', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr><w:r><w:t>one </w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr><w:del w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr><w:r><w:t>two </w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>three</w:t></w:r></w:p>`,
      );
    });
    await then('one paragraph remains with all three contents in order, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('one two three');
      }
    });
  });

  acceptTest('a trailing mark-deleted paragraph with surviving content is KEPT (no break to remove, no data loss)', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on a plain paragraph followed by a trailing mark-deleted paragraph with untracked content', () => {
      out = acceptBoth(
        `<w:p><w:r><w:t>lead</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr><w:r><w:t>tail</w:t></w:r></w:p>`,
      );
    });
    await then('both paragraphs survive with their content, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(2);
        expect(extractText(xml)).toBe('leadtail');
      }
    });
  });

  acceptTest('a trailing mark-deleted paragraph emptied by its own w:del content is removed (comparison round-trip shape)', async ({ when, then }: AllureBddContext) => {
    // wrapParagraphAsDeleted emits all runs inside w:del + the PPR-DEL mark; once the
    // run-level deletions are accepted nothing remains to merge or keep.
    let out: { ast: string; primitive: string };
    await when('accept runs on a plain paragraph followed by a trailing fully-deleted paragraph', () => {
      out = acceptBoth(
        `<w:p><w:r><w:t>lead</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr>` +
          `<w:del w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`,
      );
    });
    await then('only the lead paragraph remains, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('lead');
      }
    });
  });

  acceptTest('a mark-deleted paragraph directly before a table is KEPT (no paragraph to merge into)', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on a mark-deleted paragraph with content followed by a table', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr><w:r><w:t>before table</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `<w:p><w:r><w:t>after</w:t></w:r></w:p>`,
      );
    });
    await then('the paragraph content is not merged into the table and not lost, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(extractText(xml)).toBe('before tablecellafter');
        // The content stays in its own paragraph before the table.
        expect(xml.indexOf('before table')).toBeLessThan(xml.indexOf('<w:tbl'));
      }
    });
  });

  rejectTest('consecutive mark-inserted paragraphs cascade into the first surviving paragraph on reject', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('reject runs on two consecutive mark-inserted paragraphs followed by a plain one', () => {
      out = rejectBoth(
        `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr></w:pPr><w:r><w:t>one </w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr><w:ins w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr><w:r><w:t>two </w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>three</w:t></w:r></w:p>`,
      );
    });
    await then('one paragraph remains with all three contents in order, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('one two three');
      }
    });
  });

  rejectTest('on reject the merged paragraph keeps the FOLLOWING paragraph\'s w:pPr', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('reject runs on a centered mark-inserted paragraph followed by a styled paragraph', () => {
      out = rejectBoth(
        `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr><w:jc w:val="center"/></w:pPr><w:r><w:t>head</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>tail</w:t></w:r></w:p>`,
      );
    });
    await then('the survivor keeps its pStyle and the merged-away paragraph\'s jc is gone, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('headtail');
        expect(xml).toContain('Quote');
        expect(xml).not.toContain('center');
      }
    });
  });

  rejectTest('a trailing mark-inserted paragraph with surviving content is KEPT on reject', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('reject runs on a plain paragraph followed by a trailing mark-inserted paragraph with untracked content', () => {
      out = rejectBoth(
        `<w:p><w:r><w:t>lead</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr></w:pPr><w:r><w:t>tail</w:t></w:r></w:p>`,
      );
    });
    await then('both paragraphs survive with their content, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(2);
        expect(extractText(xml)).toBe('leadtail');
      }
    });
  });

  rejectTest('a trailing mark-inserted paragraph emptied by its own w:ins content is removed on reject', async ({ when, then }: AllureBddContext) => {
    // wrapParagraphAsInserted emits all runs inside w:ins + the PPR-INS mark; once the
    // run-level insertions are rejected nothing remains to merge or keep.
    let out: { ast: string; primitive: string };
    await when('reject runs on a plain paragraph followed by a trailing fully-inserted paragraph', () => {
      out = rejectBoth(
        `<w:p><w:r><w:t>lead</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr></w:pPr>` +
          `<w:ins w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"><w:r><w:t>gone</w:t></w:r></w:ins></w:p>`,
      );
    });
    await then('only the lead paragraph remains, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('lead');
      }
    });
  });

  rejectTest('a mark-inserted paragraph directly before a table is KEPT on reject', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('reject runs on a mark-inserted paragraph with untracked content followed by a table', () => {
      out = rejectBoth(
        `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr></w:pPr><w:r><w:t>before table</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `<w:p><w:r><w:t>after</w:t></w:r></w:p>`,
      );
    });
    await then('the paragraph content is not merged into the table and not lost, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(extractText(xml)).toBe('before tablecellafter');
        expect(xml.indexOf('before table')).toBeLessThan(xml.indexOf('<w:tbl'));
      }
    });
  });

  acceptTest('block-level customXml range markup between the paragraphs does not block the merge', async ({ when, then }: AllureBddContext) => {
    // EG_RangeMarkupElements members are valid block-level siblings (wml.xsd);
    // the merge-target scan must skip them, not bail out.
    let out: { ast: string; primitive: string };
    await when('accept runs on a mark-deleted paragraph separated from the next by a customXmlInsRangeEnd marker', () => {
      out = acceptBoth(
        `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr><w:r><w:t xml:space="preserve">First half </w:t></w:r></w:p>` +
          `<w:customXmlInsRangeEnd w:id="9"/>` +
          `<w:p><w:r><w:t>second half</w:t></w:r></w:p>`,
      );
    });
    await then('one paragraph remains reading "First half second half", on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('First half second half');
      }
    });
  });

  rejectTest('a direct-child bookmark boundary keeps its position relative to merged content on reject', async ({ when, then }: AllureBddContext) => {
    // Regression: bookmark preservation must not pre-relocate direct-child
    // bookmarks of a merging paragraph — the merge carries them in document
    // order, and an early move would put the start BEFORE the surviving
    // untracked content it follows.
    let out: { ast: string; primitive: string };
    await when('reject runs on a mark-inserted paragraph with untracked content then a bookmarkStart, whose end is in the next paragraph', () => {
      out = rejectBoth(
        `<w:p><w:pPr><w:rPr>${INS_MARK}</w:rPr></w:pPr><w:r><w:t xml:space="preserve">head </w:t></w:r><w:bookmarkStart w:id="7" w:name="bm"/></w:p>` +
          `<w:p><w:bookmarkEnd w:id="7"/><w:r><w:t>tail</w:t></w:r></w:p>`,
      );
    });
    await then('the merged paragraph reads head-bookmarkStart-bookmarkEnd-tail in that order, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(countParagraphs(xml)).toBe(1);
        expect(extractText(xml)).toBe('head tail');
        expect(xml.indexOf('head')).toBeLessThan(xml.indexOf('bookmarkStart'));
        expect(xml.indexOf('bookmarkStart')).toBeLessThan(xml.indexOf('bookmarkEnd'));
        expect(xml.indexOf('bookmarkEnd')).toBeLessThan(xml.indexOf('tail'));
      }
    });
  });

  acceptTest('an emptied mark-deleted paragraph after a trailing table is KEPT (a table must not become the last block)', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on a fully-deleted paragraph that trails a table at the end of the body', () => {
      out = acceptBoth(
        `<w:p><w:r><w:t>lead</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr>` +
          `<w:del w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`,
      );
    });
    await then('the emptied paragraph survives so the table is not the last block, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(extractText(xml)).toBe('leadcell');
        // lead + cell paragraph + kept empty trailing paragraph
        expect(countParagraphs(xml)).toBe(3);
        expect(xml.indexOf('</w:tbl>')).toBeLessThan(xml.lastIndexOf('<w:p'));
      }
    });
  });

  acceptTest('an emptied mark-deleted paragraph between two tables is KEPT (adjacent tables would merge)', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on a fully-deleted paragraph sitting between two tables', () => {
      out = acceptBoth(
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>alpha</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr>` +
          `<w:del w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>beta</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `<w:p><w:r><w:t>after</w:t></w:r></w:p>`,
      );
    });
    await then('the separator paragraph survives between the tables, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(extractText(xml)).toBe('alphabetaafter');
        // alpha cell + separator + beta cell + after
        expect(countParagraphs(xml)).toBe(4);
      }
    });
  });

  acceptTest('a lone emptied mark-deleted paragraph in a table cell is KEPT (a cell needs a block element)', async ({ when, then }: AllureBddContext) => {
    let out: { ast: string; primitive: string };
    await when('accept runs on a table cell whose only paragraph is fully deleted', () => {
      out = acceptBoth(
        `<w:tbl><w:tr><w:tc>` +
          `<w:p><w:pPr><w:rPr>${DEL_MARK}</w:rPr></w:pPr>` +
          `<w:del w:id="2" w:author="T" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>` +
          `</w:tc></w:tr></w:tbl>` +
          `<w:p><w:r><w:t>after</w:t></w:r></w:p>`,
      );
    });
    await then('the cell keeps an empty paragraph, on both paths', () => {
      for (const xml of [out.ast, out.primitive]) {
        expect(extractText(xml)).toBe('after');
        // the kept empty cell paragraph + the body paragraph
        expect(countParagraphs(xml)).toBe(2);
      }
    });
  });
});
