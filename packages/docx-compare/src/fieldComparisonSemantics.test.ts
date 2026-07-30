import { describe, expect } from 'vitest';
import { testAllure } from './testing/allure-test.js';
import {
  extractRoundTripComparisonText,
  pagerefComparisonIdentity,
} from './fieldComparisonSemantics.js';
import { classifyFieldInstruction } from './baselines/atomizer/opaquePassthrough.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'add-scoped-field-evaluation',
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' },
);

function field(instruction: string, result: string): string {
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>`
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + `<w:r><w:t>${result}</w:t></w:r>`
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
}

function documentXml(paragraphs: string): string {
  return `<w:document xmlns:w="${W_NS}"><w:body>${paragraphs}</w:body></w:document>`;
}

describe('shared field classification in comparison', () => {
  conformanceTest.openspec('[SDX-FIELD-EVAL-06] TOC PAGEREF identity uses shared classification')(
    'uses normalized PAGEREF identity instead of a volatile TOC page cache',
    () => {
      const instruction = ' pageref   &quot;_Toc 42&quot;  \\h ';
      const xml = documentXml(
        '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>'
          + field(instruction, '19')
          + '</w:p>',
      );

      expect(pagerefComparisonIdentity(' pageref   "_Toc 42"  \\h ')).toBe(
        '__safe_docx_pageref__|PAGEREF "_Toc 42" \\h',
      );
      expect(extractRoundTripComparisonText(xml)).toBe(
        '__safe_docx_pageref__|PAGEREF "_Toc 42" \\h',
      );
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-07] Suppression boundary remains narrow')(
    'keeps ordinary PAGEREF and REF cached results visible outside a TOC',
    () => {
      const xml = documentXml(
        `<w:p>${field(' PAGEREF Target \\h ', '12')}</w:p>`
          + `<w:p>${field(' REF Target \\h ', 'Clause text')}</w:p>`,
      );

      expect(extractRoundTripComparisonText(xml)).toBe('12\nClause text');
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-12] Retargeted TOC PAGEREF keeps its cache suppressed')(
    'suppresses a page-cache change when the instruction was rewritten under tracked changes',
    () => {
      // Shape taken from the committed atomizer_redline.docx fixture: the old
      // instruction survives inside w:del as plain w:instrText, fragmented
      // across two runs, alongside the reinserted current instruction.
      const body = (page: string): string =>
        '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>'
          + '<w:r><w:t>10.</w:t><w:fldChar w:fldCharType="begin"/></w:r>'
          + '<w:del w:id="25" w:author="a" w:date="2026-02-22T03:05:13Z"><w:r>'
          + '<w:instrText xml:space="preserve"> PAGEREF _Toc2</w:instrText>'
          + '<w:instrText xml:space="preserve">094301 \\h </w:instrText>'
          + '</w:r></w:del>'
          + '<w:ins w:id="26" w:author="a" w:date="2026-02-22T03:05:13Z"><w:r>'
          + '<w:instrText xml:space="preserve"> PAGEREF _Toc2094301 \\h </w:instrText>'
          + '</w:r></w:ins>'
          + `<w:r><w:fldChar w:fldCharType="separate"/><w:t>${page}</w:t>`
          + '<w:fldChar w:fldCharType="end"/></w:r></w:p>';

      const before = extractRoundTripComparisonText(documentXml(body('39')));
      const after = extractRoundTripComparisonText(documentXml(body('40')));

      expect(before).toBe(after);
      expect(before).toContain('__safe_docx_pageref__|PAGEREF _Toc2094301 \\h');
      expect(before).not.toContain('39');
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-13] Unclassifiable PAGEREF still suppresses its cache')(
    'derives an identity for PAGEREF switches the evaluation classifier rejects',
    () => {
      // Every instruction the pre-shared-classifier keyword match accepted must
      // still yield an identity, or pagination churn resurfaces as a redline.
      const legacyRecognized = [
        ' PAGEREF _Toc1 \\h ',
        ' PAGEREF _Toc1 \\# "0" ',
        ' PAGEREF _Toc1 \\y ',
        ' PAGEREF _Toc1 \\d "." ',
        ' PAGEREF "unterminated \\h ',
        ' PAGEREF ',
        ' pageref _Toc1 \\h ',
      ];

      for (const instruction of legacyRecognized) {
        expect(pagerefComparisonIdentity(instruction)).toBeDefined();
      }
      expect(pagerefComparisonIdentity(' REF _Toc1 \\h ')).toBeUndefined();
      expect(pagerefComparisonIdentity(' PAGE ')).toBeUndefined();
    },
  );

  test.openspec('[SDX-FIELD-EVAL-07] Suppression boundary remains narrow')(
    'preserves every instruction the pre-shared-classifier parser preserved',
    () => {
      // Oracle: the switch validator opaquePassthrough carried before it
      // delegated to the shared classifier. Rebuild preservation is a shipped
      // guarantee, so the replacement may widen but must never narrow.
      const legacyPreserved = (instruction: string): string | null => {
        const tokens = instruction.trim().split(/\s+/u).filter(Boolean);
        if (tokens.length === 0) return null;
        const keyword = tokens[0]!.toUpperCase();
        const valid = (allowed: Set<string>, argument: Set<string>, from: number): boolean => {
          for (let index = from; index < tokens.length; index += 1) {
            const token = tokens[index]!;
            if (!token.startsWith('\\') || token.length !== 2) return false;
            const name = token[1]!.toLowerCase();
            if (!allowed.has(name)) return false;
            if (argument.has(name)) {
              const next = tokens[index + 1];
              if (!next || next.startsWith('\\')) return false;
              index += 1;
            }
          }
          return true;
        };
        if (keyword === 'PAGE' || keyword === 'NUMPAGES') {
          return valid(new Set(['*', '#']), new Set(['*', '#']), 1) ? keyword : null;
        }
        if (keyword !== 'REF' && keyword !== 'PAGEREF') return null;
        const bookmark = tokens[1];
        if (!bookmark || bookmark.startsWith('\\')) return null;
        return valid(
          keyword === 'REF'
            ? new Set(['d', 'f', 'h', 'n', 'p', 'r', 't', 'w', '*'])
            : new Set(['h', 'p', '*']),
          keyword === 'REF' ? new Set(['*', 'd']) : new Set(['*']),
          2,
        )
          ? keyword
          : null;
      };

      const corpus = [
        ' PAGE ', ' PAGE \\* MERGEFORMAT ', ' PAGE \\* Arabic ', ' PAGE \\# "0" ',
        ' NUMPAGES ', ' NUMPAGES \\* MERGEFORMAT ',
        ' PAGEREF _Toc1 ', ' PAGEREF _Toc1 \\h ', ' PAGEREF _Toc1 \\h \\* MERGEFORMAT ',
        ' PAGEREF _Ref1 \\p \\h ', ' PAGEREF _Toc1 \\n ',
        ' REF _Ref1 ', ' REF _Ref1 \\h ', ' REF _Ref1 \\n \\h ', ' REF _Ref1 \\r \\h ',
        ' REF _Ref1 \\w ', ' REF _Ref1 \\f ', ' REF _Ref1 \\t ', ' REF _Ref1 \\p \\h ',
        ' REF _Ref1 \\d "." \\n ', ' REF _Ref1 \\* CHARFORMAT ', ' REF _Ref1 \\* Upper ',
        ' REF _Ref1 \\* MERGEFORMAT ', ' REF _Ref1 \\q ', ' REF _Ref1 \\* ',
        ' REF _Ref1 \\d ', ' REF ', ' ref _Ref1 \\h ', ' REF _Ref1 \\h extra ',
        ' TOC \\o "1-3" \\h \\z \\u ', ' SEQ Figure \\* ARABIC ', ' HYPERLINK "http://x" ',
        ' STYLEREF 1 \\s ', '',
      ];

      const narrowed = corpus.filter(
        (instruction) =>
          legacyPreserved(instruction) !== null &&
          classifyFieldInstruction(instruction) === null,
      );

      expect(narrowed).toEqual([]);
    },
  );
});
