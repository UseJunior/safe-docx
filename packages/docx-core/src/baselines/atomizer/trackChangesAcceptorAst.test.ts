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
import { findAllByTagName } from '../../primitives/index.js';

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
