import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './allure-test.js';
import { xmlToDocPreviewRuns } from './allure-preview-helpers.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Allure Preview Helpers' });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wraps run XML in a minimal document envelope. */
const wrapBody = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

const wrapP = (runs: string) => `<w:p>${runs}</w:p>`;
const wrapR = (content: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${content}</w:r>`;

// ── Basic text extraction ────────────────────────────────────────────────────

describe('xmlToDocPreviewRuns', () => {
  describe('text extraction', () => {
    test('extracts plain text from a single run', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with a single text run "Hello World"', () => {
        // setup in when
      });
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>Hello World</w:t>'))),
        );
      });
      await then('one run is returned with the text "Hello World"', () => {
        expect(result).toEqual([{ text: 'Hello World' }]);
      });
    });

    test('extracts text from multiple runs', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with two runs "Hello " and "World"', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(
              wrapR('<w:t>Hello </w:t>') + wrapR('<w:t>World</w:t>'),
            ),
          ),
        );
      });
      await then('two runs are returned', () => {
        expect(result).toHaveLength(2);
      });
      await and('texts match "Hello " and "World"', () => {
        expect(result.map((r) => r.text)).toEqual(['Hello ', 'World']);
      });
    });

    test('handles w:delText for deleted text', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with w:delText "removed"', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:delText>removed</w:delText>'))),
        );
      });
      await then('the deleted text is extracted', () => {
        expect(result).toEqual([{ text: 'removed' }]);
      });
    });

    test('handles tab and break elements', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with text, tab, and break elements', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t>'))),
        );
      });
      await then('the text includes tab and newline characters', () => {
        expect(result).toEqual([{ text: 'A\tB\nC' }]);
      });
    });

    test('returns empty array for empty document', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('an empty document body', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(wrapBody(''));
      });
      await then('an empty array is returned', () => {
        expect(result).toEqual([]);
      });
    });
  });

  // ── Formatting ─────────────────────────────────────────────────────────────

  describe('formatting', () => {
    test('extracts bold formatting', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with bold formatting', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>Bold</w:t>', '<w:b/>'))),
        );
      });
      await then('the run has bold=true', () => {
        expect(result).toEqual([{ text: 'Bold', bold: true }]);
      });
    });

    test('extracts italic formatting', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with italic formatting', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>Italic</w:t>', '<w:i/>'))),
        );
      });
      await then('the run has italic=true', () => {
        expect(result).toEqual([{ text: 'Italic', italic: true }]);
      });
    });

    test('extracts underline formatting', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with underline formatting', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>Underlined</w:t>', '<w:u w:val="single"/>'))),
        );
      });
      await then('the run has underline=true', () => {
        expect(result).toEqual([{ text: 'Underlined', underline: true }]);
      });
    });

    test('extracts combined bold+italic formatting', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with bold and italic formatting', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>Both</w:t>', '<w:b/><w:i/>'))),
        );
      });
      await then('the run has both bold and italic', () => {
        expect(result).toEqual([{ text: 'Both', bold: true, italic: true }]);
      });
    });

    test('respects w:val="0" to disable formatting', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with bold explicitly disabled via w:val="0"', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>NotBold</w:t>', '<w:b w:val="0"/>'))),
        );
      });
      await then('the run has no bold property', () => {
        expect(result).toEqual([{ text: 'NotBold' }]);
      });
    });

    test('extracts superscript vertAlign', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with vertAlign="superscript"', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>2</w:t>', '<w:vertAlign w:val="superscript"/>'))),
        );
      });
      await then('the run has script="superscript"', () => {
        expect(result).toEqual([{ text: '2', script: 'superscript' }]);
      });
    });

    test('extracts subscript vertAlign', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with vertAlign="subscript"', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>2</w:t>', '<w:vertAlign w:val="subscript"/>'))),
        );
      });
      await then('the run has script="subscript"', () => {
        expect(result).toEqual([{ text: '2', script: 'subscript' }]);
      });
    });

    test('extracts position in half-points', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with position="6" (3pt raised)', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>Raised</w:t>', '<w:position w:val="6"/>'))),
        );
      });
      await then('the run has positionHpt=6', () => {
        expect(result).toEqual([{ text: 'Raised', positionHpt: 6 }]);
      });
    });
  });

  // ── Revision wrappers ──────────────────────────────────────────────────────

  describe('revision wrappers', () => {
    test('marks runs inside w:ins as insertion', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with an inserted run', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(`<w:ins w:author="Alice">${wrapR('<w:t>added</w:t>')}</w:ins>`),
          ),
        );
      });
      await then('the run is marked as insertion with author', () => {
        expect(result).toEqual([
          { text: 'added', revision: 'insertion', revisionAuthor: 'Alice' },
        ]);
      });
    });

    test('marks runs inside w:del as deletion', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with a deleted run', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(`<w:del w:author="Bob">${wrapR('<w:delText>removed</w:delText>')}</w:del>`),
          ),
        );
      });
      await then('the run is marked as deletion with author', () => {
        expect(result).toEqual([
          { text: 'removed', revision: 'deletion', revisionAuthor: 'Bob' },
        ]);
      });
    });

    test('marks runs inside w:moveFrom as move-from', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with a moveFrom wrapper', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(`<w:moveFrom w:author="Carol">${wrapR('<w:t>moved</w:t>')}</w:moveFrom>`),
          ),
        );
      });
      await then('the run is marked as move-from', () => {
        expect(result).toEqual([
          { text: 'moved', revision: 'move-from', revisionAuthor: 'Carol' },
        ]);
      });
    });

    test('marks runs inside w:moveTo as move-to', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with a moveTo wrapper', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(`<w:moveTo w:author="Dave">${wrapR('<w:t>moved</w:t>')}</w:moveTo>`),
          ),
        );
      });
      await then('the run is marked as move-to', () => {
        expect(result).toEqual([
          { text: 'moved', revision: 'move-to', revisionAuthor: 'Dave' },
        ]);
      });
    });

    test('preserves formatting inside revision wrappers', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a bold run inside an insertion wrapper', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(`<w:ins w:author="Alice">${wrapR('<w:t>bold added</w:t>', '<w:b/>')}</w:ins>`),
          ),
        );
      });
      await then('the run has both bold and insertion metadata', () => {
        expect(result).toEqual([
          { text: 'bold added', bold: true, revision: 'insertion', revisionAuthor: 'Alice' },
        ]);
      });
    });
  });

  // ── Multi-paragraph ────────────────────────────────────────────────────────

  describe('multi-paragraph', () => {
    test('separates paragraphs with newlines', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('two paragraphs with text', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(
            wrapP(wrapR('<w:t>First</w:t>')) + wrapP(wrapR('<w:t>Second</w:t>')),
          ),
        );
      });
      await then('two runs are returned', () => {
        expect(result).toHaveLength(2);
      });
      await and('the first run text ends with a newline separator', () => {
        expect(result[0]!.text).toBe('First\n');
        expect(result[1]!.text).toBe('Second');
      });
    });
  });

  // ── Field codes ────────────────────────────────────────────────────────────

  describe('field codes', () => {
    test('skips field instruction text but includes results', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a paragraph with a field code and result text', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        const fieldXml = [
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
          '<w:r><w:instrText> PAGEREF _Toc123 </w:instrText></w:r>',
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
          '<w:r><w:t>42</w:t></w:r>',
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
        ].join('');
        result = xmlToDocPreviewRuns(wrapBody(wrapP(fieldXml)));
      });
      await then('only the field result "42" is returned', () => {
        expect(result).toEqual([{ text: '42' }]);
      });
    });
  });

  // ── Fragment wrapping ──────────────────────────────────────────────────────

  describe('fragment wrapping', () => {
    test('wraps bare paragraph fragment', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a bare paragraph XML fragment without document wrapper', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>fragment</w:t></w:r></w:p>`,
        );
      });
      await then('the text is extracted correctly', () => {
        expect(result).toEqual([{ text: 'fragment' }]);
      });
    });

    test('wraps bare run fragment', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a bare run XML fragment without paragraph wrapper', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t>bare run</w:t></w:r>`,
        );
      });
      await then('the text is extracted correctly', () => {
        expect(result).toEqual([{ text: 'bare run' }]);
      });
    });
  });

  // ── Fallback behavior ──────────────────────────────────────────────────────

  describe('fallback', () => {
    test('never throws on malformed XML', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('completely malformed XML', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns('<not valid xml>>><<<');
      });
      await then('a fallback result is returned without throwing', () => {
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      });
    });

    test('returns empty array for empty string', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('an empty string', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns('');
      });
      await then('an empty array is returned', () => {
        expect(result).toEqual([]);
      });
    });

    test('extracts raw text from unparseable fragments', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('plain text without XML structure', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns('Just plain text');
      });
      await then('the raw text is returned as a single run', () => {
        expect(result).toEqual([{ text: 'Just plain text' }]);
      });
    });
  });

  // ── underline w:val="none" ─────────────────────────────────────────────────

  describe('edge cases', () => {
    test('treats w:u val="none" as not underlined', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof xmlToDocPreviewRuns>;

      await given('a run with underline explicitly set to "none"', () => {});
      await when('xmlToDocPreviewRuns is called', () => {
        result = xmlToDocPreviewRuns(
          wrapBody(wrapP(wrapR('<w:t>NoUL</w:t>', '<w:u w:val="none"/>'))),
        );
      });
      await then('the run has no underline property', () => {
        expect(result).toEqual([{ text: 'NoUL' }]);
      });
    });
  });
});
