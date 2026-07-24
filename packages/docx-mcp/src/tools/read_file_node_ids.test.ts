import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { readFile } from './read_file.js';

const CANONICAL_ID = '_bk_616616616616';
const FOREIGN_ID = 'jr_para_issue616';
const POINT_ID = '_RefPoint';
const MULTI_PARAGRAPH_ID = '_TocSpan';

function makeDocumentXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

describe('read_file node_ids bookmark resolution', () => {
  const test = testAllure.epic('Document Reading').withLabels({
    feature: 'Read File Node Ids',
  });

  registerCleanup();

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' })(
      'accepts a foreign single-paragraph bookmark but refuses point and multi-paragraph bookmarks',
      async ({ given, when, then, and }: AllureBddContext) => {
        const documentXml = makeDocumentXml(
          `<w:bookmarkStart w:id="1" w:name="${FOREIGN_ID}"/>` +
            `<w:bookmarkStart w:id="2" w:name="${CANONICAL_ID}"/>` +
            `<w:p><w:r><w:t>Foreign bookmark target</w:t></w:r></w:p>` +
            `<w:bookmarkEnd w:id="2"/>` +
            `<w:bookmarkEnd w:id="1"/>` +
            `<w:bookmarkStart w:id="3" w:name="${POINT_ID}"/>` +
            `<w:bookmarkEnd w:id="3"/>` +
            `<w:p><w:r><w:t>Point bookmark neighbor</w:t></w:r></w:p>` +
            `<w:bookmarkStart w:id="4" w:name="${MULTI_PARAGRAPH_ID}"/>` +
            `<w:p><w:r><w:t>Multi-paragraph range start</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>Multi-paragraph range end</w:t></w:r></w:p>` +
            `<w:bookmarkEnd w:id="4"/>`,
        );
        const mgr = createTestSessionManager();
        const opened = await given('a DOCX with qualified and refused foreign bookmark ranges', () =>
          openSession([], { mgr, xml: documentXml }),
        );

        const selected = await when('read_file targets the qualified foreign bookmark name', async () => {
          const result = await readFile(mgr, {
            file_path: opened.filePath,
            format: 'json',
            node_ids: [FOREIGN_ID],
          });
          assertSuccess(result, 'read qualified foreign bookmark');
          return {
            result,
            nodes: JSON.parse(String(result.content)) as Array<{
              id: string;
              clean_text: string;
            }>,
          };
        });

        await then('the target paragraph is returned under its canonical safe-docx id', async () => {
          expect(Number(selected.result.paragraphs_returned)).toBe(1);
          expect(selected.nodes).toHaveLength(1);
          expect(selected.nodes[0]?.clean_text).toBe('Foreign bookmark target');
          expect(selected.nodes[0]?.id).toBe(CANONICAL_ID);
          expect(selected.nodes[0]?.id).not.toBe(FOREIGN_ID);
        });

        const refused = await when('read_file targets point and multi-paragraph bookmark names', async () => {
          const point = await readFile(mgr, {
            file_path: opened.filePath,
            format: 'json',
            node_ids: [POINT_ID],
          });
          const multiParagraph = await readFile(mgr, {
            file_path: opened.filePath,
            format: 'json',
            node_ids: [MULTI_PARAGRAPH_ID],
          });
          assertSuccess(point, 'read point bookmark');
          assertSuccess(multiParagraph, 'read multi-paragraph bookmark');
          return { point, multiParagraph };
        });

        await and('both refused selectors return zero rows', async () => {
          expect(Number(refused.point.paragraphs_returned)).toBe(0);
          expect(JSON.parse(String(refused.point.content))).toEqual([]);
          expect(Number(refused.multiParagraph.paragraphs_returned)).toBe(0);
          expect(JSON.parse(String(refused.multiParagraph.content))).toEqual([]);
        });
      },
    );

  test('de-duplicates aliased selectors and returns rows in document order', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const CANON_A = '_bk_aaaaaaaaaaaa';
    const CANON_B = '_bk_bbbbbbbbbbbb';
    const FOREIGN_A1 = 'jr_para_a_one';
    const FOREIGN_A2 = 'jr_para_a_two';
    const FOREIGN_B = 'jr_para_b';
    // Paragraph A carries a canonical id plus two foreign aliases; paragraph B a
    // canonical id plus one foreign alias. A appears before B in document order.
    const documentXml = makeDocumentXml(
      `<w:bookmarkStart w:id="1" w:name="${CANON_A}"/>` +
        `<w:bookmarkStart w:id="2" w:name="${FOREIGN_A1}"/>` +
        `<w:bookmarkStart w:id="3" w:name="${FOREIGN_A2}"/>` +
        `<w:p><w:r><w:t>Paragraph A</w:t></w:r></w:p>` +
        `<w:bookmarkEnd w:id="3"/><w:bookmarkEnd w:id="2"/><w:bookmarkEnd w:id="1"/>` +
        `<w:bookmarkStart w:id="4" w:name="${CANON_B}"/>` +
        `<w:bookmarkStart w:id="5" w:name="${FOREIGN_B}"/>` +
        `<w:p><w:r><w:t>Paragraph B</w:t></w:r></w:p>` +
        `<w:bookmarkEnd w:id="5"/><w:bookmarkEnd w:id="4"/>`,
    );
    const mgr = createTestSessionManager();
    const opened = await given('a DOCX with two paragraphs each carrying foreign aliases', () =>
      openSession([], { mgr, xml: documentXml }),
    );

    const readIds = async (nodeIds: string[]) => {
      const result = await readFile(mgr, { file_path: opened.filePath, format: 'json', node_ids: nodeIds });
      assertSuccess(result, `read ${nodeIds.join(',')}`);
      return JSON.parse(String(result.content)) as Array<{ id: string; clean_text: string }>;
    };

    await then('two foreign aliases for one paragraph emit exactly one canonical row', async () => {
      const rows = await readIds([FOREIGN_A1, FOREIGN_A2]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(CANON_A);
    });

    await when('a canonical id and a foreign alias select the same paragraph', async () => {
      const rows = await readIds([CANON_A, FOREIGN_A1]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(CANON_A);
    });

    await then('selectors given out of document order return document-ordered rows', async () => {
      const rows = await readIds([FOREIGN_B, FOREIGN_A1]);
      expect(rows.map((r) => r.id)).toEqual([CANON_A, CANON_B]);
    });
  });
});
