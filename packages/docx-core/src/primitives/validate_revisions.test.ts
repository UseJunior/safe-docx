import { describe, expect } from 'vitest';
import { parseXml } from './xml.js';
import {
  createRevisionValidationBaseline,
  partitionRevisionValidationIssues,
  validateRevisions,
} from './validate_revisions.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const TEST_FEATURE = 'add-ai-revision-validator';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function doc(body: string): Document {
  return parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`);
}

describe('validateRevisions', () => {
  test.openspec('session-owned malformed revision is reported as an error')(
    'Scenario: session-owned malformed revision is reported as an error',
    async ({ when, then }: AllureBddContext) => {
      let result: ReturnType<typeof partitionRevisionValidationIssues>;

      await when('a session-owned insertion is missing author and date metadata', () => {
        const issues = validateRevisions([
          { partName: 'word/document.xml', doc: doc('<w:p><w:ins w:id="10"/></w:p>') },
        ], { sessionStartId: 10, expectedAuthor: 'AI' });
        result = partitionRevisionValidationIssues(issues, { sessionStartId: 10, expectedAuthor: 'AI' });
      });

      await then('the issue is classified as a hard error', () => {
        expect(result.errors.map((issue) => issue.code)).toContain('MISSING_REVISION_ATTR');
        expect(result.warnings).toHaveLength(0);
      });
    },
  );

  test.openspec('pre-existing malformed revision remains a warning')(
    'Scenario: pre-existing malformed revision remains a warning',
    async ({ when, then }: AllureBddContext) => {
      let result: ReturnType<typeof partitionRevisionValidationIssues>;

      await when('a pre-existing deletion is malformed below the session id boundary', () => {
        const issues = validateRevisions([
          { partName: 'word/document.xml', doc: doc('<w:p><w:del w:id="9"/></w:p>') },
        ], { sessionStartId: 10, expectedAuthor: 'AI' });
        result = partitionRevisionValidationIssues(issues, { sessionStartId: 10, expectedAuthor: 'AI' });
      });

      await then('the issue is retained as a warning', () => {
        expect(result.errors).toHaveLength(0);
        expect(result.warnings.map((issue) => issue.code)).toContain('MISSING_REVISION_ATTR');
      });
    },
  );

  test.openspec('marker family rules are vocabulary-complete')(
    'Scenario: marker family rules are vocabulary-complete',
    async ({ when, then }: AllureBddContext) => {
      let issues: ReturnType<typeof validateRevisions>;

      await when('id-only table grid and customXml range-end markers are validated', () => {
        issues = validateRevisions([
          {
            partName: 'word/document.xml',
            doc: doc(
              '<w:tbl><w:tblGridChange w:id="11"><w:tblGrid/></w:tblGridChange></w:tbl>' +
              '<w:customXmlInsRangeStart w:id="12"/><w:customXmlInsRangeEnd w:id="12"/>',
            ),
          },
        ], { sessionStartId: 10, expectedAuthor: 'AI' });
      });

      await then('the validator does not require author/date on id-only marker families', () => {
        expect(issues.filter((issue) => issue.code === 'MISSING_REVISION_ATTR')).toHaveLength(0);
      });
    },
  );

  test('tainted baseline marker ids remain warnings after issue manifestation changes', async ({ when, then }: AllureBddContext) => {
    let result: ReturnType<typeof partitionRevisionValidationIssues>;

    await when('a baseline range defect changes from unmatched start to unmatched end for the same id', () => {
      const baseline = createRevisionValidationBaseline(validateRevisions([
        { partName: 'word/document.xml', doc: doc('<w:moveFromRangeStart w:id="7" w:author="Legacy" w:date="2026-01-01T00:00:00Z" w:name="m"/>') },
      ]));
      const issues = validateRevisions([
        { partName: 'word/document.xml', doc: doc('<w:moveFromRangeEnd w:id="7"/>') },
      ], { sessionStartId: 10, expectedAuthor: 'AI' });
      result = partitionRevisionValidationIssues(issues, { sessionStartId: 10, expectedAuthor: 'AI' }, baseline);
    });

    await then('the tainted marker id is not promoted to an error', () => {
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.map((issue) => issue.code)).toContain('UNMATCHED_RANGE_END');
    });
  });

  const AI_ATTRS = 'w:author="AI" w:date="2026-06-12T00:00:00Z"';
  // One valid fixture (expected to produce zero issues) and one invalid
  // fixture (expected to produce MISSING_REVISION_ATTR) per revision element
  // family in REVISION_ELEMENT_RULES.
  const FAMILY_FIXTURES: ReadonlyArray<{ family: string; valid: string; invalid: string }> = [
    { family: 'ins', valid: `<w:p><w:ins w:id="20" ${AI_ATTRS}><w:r><w:t>x</w:t></w:r></w:ins></w:p>`, invalid: '<w:p><w:ins w:id="20" w:date="2026-06-12T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins></w:p>' },
    { family: 'del', valid: `<w:p><w:del w:id="20" ${AI_ATTRS}><w:r><w:delText>x</w:delText></w:r></w:del></w:p>`, invalid: '<w:p><w:del w:id="20" w:date="2026-06-12T00:00:00Z"><w:r><w:delText>x</w:delText></w:r></w:del></w:p>' },
    { family: 'moveFrom', valid: `<w:p><w:moveFrom w:id="20" ${AI_ATTRS}><w:r><w:t>x</w:t></w:r></w:moveFrom></w:p>`, invalid: '<w:p><w:moveFrom w:id="20" w:date="2026-06-12T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:moveFrom></w:p>' },
    { family: 'moveTo', valid: `<w:p><w:moveTo w:id="20" ${AI_ATTRS}><w:r><w:t>x</w:t></w:r></w:moveTo></w:p>`, invalid: '<w:p><w:moveTo w:id="20" w:date="2026-06-12T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:moveTo></w:p>' },
    { family: 'pPrChange', valid: `<w:p><w:pPr><w:pPrChange w:id="20" ${AI_ATTRS}><w:pPr/></w:pPrChange></w:pPr></w:p>`, invalid: '<w:p><w:pPr><w:pPrChange w:id="20" w:date="2026-06-12T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr></w:p>' },
    { family: 'rPrChange', valid: `<w:p><w:r><w:rPr><w:rPrChange w:id="20" ${AI_ATTRS}><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r></w:p>`, invalid: '<w:p><w:r><w:rPr><w:rPrChange w:id="20" w:date="2026-06-12T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r></w:p>' },
    { family: 'tblPrChange', valid: `<w:tbl><w:tblPr><w:tblPrChange w:id="20" ${AI_ATTRS}><w:tblPr/></w:tblPrChange></w:tblPr></w:tbl>`, invalid: '<w:tbl><w:tblPr><w:tblPrChange w:id="20" w:date="2026-06-12T00:00:00Z"><w:tblPr/></w:tblPrChange></w:tblPr></w:tbl>' },
    { family: 'tblPrExChange', valid: `<w:tbl><w:tr><w:tblPrEx><w:tblPrExChange w:id="20" ${AI_ATTRS}><w:tblPrEx/></w:tblPrExChange></w:tblPrEx></w:tr></w:tbl>`, invalid: '<w:tbl><w:tr><w:tblPrEx><w:tblPrExChange w:id="20" w:date="2026-06-12T00:00:00Z"><w:tblPrEx/></w:tblPrExChange></w:tblPrEx></w:tr></w:tbl>' },
    { family: 'tblGridChange', valid: '<w:tbl><w:tblGridChange w:id="20"><w:tblGrid/></w:tblGridChange></w:tbl>', invalid: '<w:tbl><w:tblGridChange><w:tblGrid/></w:tblGridChange></w:tbl>' },
    { family: 'trPrChange', valid: `<w:tbl><w:tr><w:trPr><w:trPrChange w:id="20" ${AI_ATTRS}><w:trPr/></w:trPrChange></w:trPr></w:tr></w:tbl>`, invalid: '<w:tbl><w:tr><w:trPr><w:trPrChange w:id="20" w:date="2026-06-12T00:00:00Z"><w:trPr/></w:trPrChange></w:trPr></w:tr></w:tbl>' },
    { family: 'tcPrChange', valid: `<w:tbl><w:tr><w:tc><w:tcPr><w:tcPrChange w:id="20" ${AI_ATTRS}><w:tcPr/></w:tcPrChange></w:tcPr></w:tc></w:tr></w:tbl>`, invalid: '<w:tbl><w:tr><w:tc><w:tcPr><w:tcPrChange w:id="20" w:date="2026-06-12T00:00:00Z"><w:tcPr/></w:tcPrChange></w:tcPr></w:tc></w:tr></w:tbl>' },
    { family: 'sectPrChange', valid: `<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="20" ${AI_ATTRS}/></w:sectPr></w:pPr></w:p>`, invalid: '<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="20" w:date="2026-06-12T00:00:00Z"/></w:sectPr></w:pPr></w:p>' },
    { family: 'cellIns', valid: `<w:tbl><w:tr><w:tc><w:tcPr><w:cellIns w:id="20" ${AI_ATTRS}/></w:tcPr></w:tc></w:tr></w:tbl>`, invalid: '<w:tbl><w:tr><w:tc><w:tcPr><w:cellIns w:id="20" w:author="AI"/></w:tcPr></w:tc></w:tr></w:tbl>' },
    { family: 'cellDel', valid: `<w:tbl><w:tr><w:tc><w:tcPr><w:cellDel w:id="20" ${AI_ATTRS}/></w:tcPr></w:tc></w:tr></w:tbl>`, invalid: '<w:tbl><w:tr><w:tc><w:tcPr><w:cellDel w:id="20" w:author="AI"/></w:tcPr></w:tc></w:tr></w:tbl>' },
    { family: 'cellMerge', valid: `<w:tbl><w:tr><w:tc><w:tcPr><w:cellMerge w:id="20" ${AI_ATTRS}/></w:tcPr></w:tc></w:tr></w:tbl>`, invalid: '<w:tbl><w:tr><w:tc><w:tcPr><w:cellMerge w:id="20" w:author="AI"/></w:tcPr></w:tc></w:tr></w:tbl>' },
    { family: 'numberingChange', valid: `<w:p><w:pPr><w:numPr><w:numberingChange w:id="20" ${AI_ATTRS}/></w:numPr></w:pPr></w:p>`, invalid: '<w:p><w:pPr><w:numPr><w:numberingChange w:id="20" w:author="AI"/></w:numPr></w:pPr></w:p>' },
    { family: 'moveFromRange', valid: `<w:moveFromRangeStart w:id="20" ${AI_ATTRS} w:name="m"/><w:p/><w:moveFromRangeEnd w:id="20"/>`, invalid: `<w:moveFromRangeStart w:id="20" ${AI_ATTRS}/><w:p/><w:moveFromRangeEnd w:id="20"/>` },
    { family: 'moveToRange', valid: `<w:moveToRangeStart w:id="20" ${AI_ATTRS} w:name="m"/><w:p/><w:moveToRangeEnd w:id="20"/>`, invalid: `<w:moveToRangeStart w:id="20" ${AI_ATTRS}/><w:p/><w:moveToRangeEnd w:id="20"/>` },
    { family: 'customXmlInsRange', valid: '<w:customXmlInsRangeStart w:id="20"/><w:p/><w:customXmlInsRangeEnd w:id="20"/>', invalid: '<w:customXmlInsRangeStart/><w:p/><w:customXmlInsRangeEnd w:id="20"/>' },
    { family: 'customXmlDelRange', valid: '<w:customXmlDelRangeStart w:id="20"/><w:p/><w:customXmlDelRangeEnd w:id="20"/>', invalid: '<w:customXmlDelRangeStart/><w:p/><w:customXmlDelRangeEnd w:id="20"/>' },
    { family: 'customXmlMoveFromRange', valid: '<w:customXmlMoveFromRangeStart w:id="20"/><w:p/><w:customXmlMoveFromRangeEnd w:id="20"/>', invalid: '<w:customXmlMoveFromRangeStart/><w:p/><w:customXmlMoveFromRangeEnd w:id="20"/>' },
    { family: 'customXmlMoveToRange', valid: '<w:customXmlMoveToRangeStart w:id="20"/><w:p/><w:customXmlMoveToRangeEnd w:id="20"/>', invalid: '<w:customXmlMoveToRangeStart/><w:p/><w:customXmlMoveToRangeEnd w:id="20"/>' },
  ];

  test.openspec('every revision element family has positive and negative validation coverage')(
    'Scenario: every revision element family has positive and negative validation coverage',
    async ({ when, then }: AllureBddContext) => {
      const scope = { sessionStartId: 10, expectedAuthor: 'AI' };
      const failures: string[] = [];

      await when('valid and invalid fixtures for every revision element family are validated', () => {
        for (const { family, valid, invalid } of FAMILY_FIXTURES) {
          const validIssues = validateRevisions([{ partName: 'word/document.xml', doc: doc(valid) }], scope);
          if (validIssues.length > 0) {
            failures.push(`${family} valid fixture produced: ${validIssues.map((i) => i.code).join(',')}`);
          }
          const invalidIssues = validateRevisions([{ partName: 'word/document.xml', doc: doc(invalid) }], scope);
          if (!invalidIssues.some((i) => i.code === 'MISSING_REVISION_ATTR')) {
            failures.push(`${family} invalid fixture did not report MISSING_REVISION_ATTR`);
          }
        }
      });

      await then('every valid fixture is clean and every invalid fixture reports the missing attribute', () => {
        expect(failures).toEqual([]);
      });
    },
  );

  test.openspec('pre-existing non-revision marker defects are never attributed to the session')(
    'Scenario: pre-existing non-revision marker defects are never attributed to the session',
    async ({ when, then }: AllureBddContext) => {
      let withBaseline: ReturnType<typeof partitionRevisionValidationIssues>;
      let withoutBaseline: ReturnType<typeof partitionRevisionValidationIssues>;

      await when('a pre-existing unmatched comment range marker id falls inside the session revision-id range', () => {
        // Comment/permission marker ids are allocated outside RevisionIdState,
        // so a low marker id can numerically overlap the session id range in a
        // document that had no pre-existing revisions (sessionStartId = 1).
        const defective = doc('<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>x</w:t></w:r></w:p>');
        const scope = { sessionStartId: 1, expectedAuthor: 'AI' };
        const baseline = createRevisionValidationBaseline(
          validateRevisions([{ partName: 'word/document.xml', doc: defective }]),
        );
        const issues = validateRevisions([{ partName: 'word/document.xml', doc: defective }], scope);
        withBaseline = partitionRevisionValidationIssues(issues, scope, baseline);
        withoutBaseline = partitionRevisionValidationIssues(issues, scope, null);
      });

      await then('the defect stays a warning with and without a baseline', () => {
        expect(withBaseline.errors).toHaveLength(0);
        expect(withBaseline.warnings.map((issue) => issue.code)).toContain('UNMATCHED_RANGE_START');
        expect(withoutBaseline.errors).toHaveLength(0);
        expect(withoutBaseline.warnings.map((issue) => issue.code)).toContain('UNMATCHED_RANGE_START');
      });
    },
  );

  test('breaking a clean comment range pair during the session is a hard error', async ({ when, then }: AllureBddContext) => {
    let result: ReturnType<typeof partitionRevisionValidationIssues>;

    await when('a comment range balanced at session open is unbalanced after a write', () => {
      const scope = { sessionStartId: 1, expectedAuthor: 'AI' };
      const baseline = createRevisionValidationBaseline(validateRevisions([
        { partName: 'word/document.xml', doc: doc('<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="3"/></w:p>') },
      ]));
      const issues = validateRevisions([
        { partName: 'word/document.xml', doc: doc('<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>x</w:t></w:r></w:p>') },
      ], scope);
      result = partitionRevisionValidationIssues(issues, scope, baseline);
    });

    await then('the new unbalance is attributed to the session write', () => {
      expect(result.errors.map((issue) => issue.code)).toContain('UNMATCHED_RANGE_START');
    });
  });

  test('instruction text outside a field sequence is reported', async ({ when, then }: AllureBddContext) => {
    let issues: ReturnType<typeof validateRevisions>;

    await when('an instrText run appears with no enclosing fldChar begin/end pair', () => {
      issues = validateRevisions([
        { partName: 'word/document.xml', doc: doc('<w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>') },
      ]);
    });

    await then('the field structure check reports it', () => {
      expect(issues.map((issue) => issue.code)).toContain('INSTRTEXT_OUTSIDE_FIELD');
    });
  });

  test('revision ids must be unique across story parts', async ({ when, then }: AllureBddContext) => {
    let issues: ReturnType<typeof validateRevisions>;

    await when('document.xml and footnotes.xml reuse the same revision id', () => {
      issues = validateRevisions([
        { partName: 'word/document.xml', doc: doc('<w:p><w:ins w:id="20" w:author="AI" w:date="2026-06-12T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins></w:p>') },
        { partName: 'word/footnotes.xml', doc: doc('<w:p><w:ins w:id="20" w:author="AI" w:date="2026-06-12T00:00:00Z"><w:r><w:t>y</w:t></w:r></w:ins></w:p>') },
      ]);
    });

    await then('a duplicate revision id is reported', () => {
      expect(issues.map((issue) => issue.code)).toContain('DUPLICATE_REVISION_ID');
    });
  });
});
