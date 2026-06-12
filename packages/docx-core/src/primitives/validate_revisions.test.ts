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
});
