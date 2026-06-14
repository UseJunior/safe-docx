import { describe, expect } from 'vitest';

import { testAllure } from '../testing/allure-test.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { insertParagraph } from './insert_paragraph.js';

const TEST_FEATURE = 'add-apply-plan-and-style-source';

describe('Traceability: style_source_id', () => {
  registerCleanup();
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  humanReadableTest.openspec('style_source_id clones formatting from specified paragraph')(
    'Scenario: style_source_id clones formatting from specified paragraph',
    async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Body paragraph</w:t></w:r></w:p>` +
        `</w:body></w:document>`;

      const opened = await openSession([], { xml });
      const result = await insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.paraIds[0],
        position: 'AFTER',
        new_string: 'Inserted with body style source',
        instruction: 'insert after heading',
        style_source_id: opened.paraIds[1],
      });

      assertSuccess(result);
      expect(result.style_source_warning).toBeUndefined();
    },
  );

  humanReadableTest.openspec('style_source_id falls back to anchor with warning')(
    'Scenario: style_source_id falls back to anchor with warning',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.firstParaId,
        position: 'AFTER',
        new_string: 'Inserted with fallback',
        instruction: 'insert with missing style source',
        style_source_id: '_bk_missing_style_source',
      });

      assertSuccess(result);
      expect(String(result.style_source_warning ?? '')).toContain('not found');
      expect(String(result.style_source_warning ?? '')).toContain('fell back');
    },
  );

  humanReadableTest.openspec('style_source_id omitted uses anchor formatting (backward compatible)')(
    'Scenario: style_source_id omitted uses anchor formatting (backward compatible)',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.firstParaId,
        position: 'AFTER',
        new_string: 'Inserted without style source',
        instruction: 'insert with anchor style',
      });

      assertSuccess(result);
      expect(result.style_source_warning).toBeUndefined();
    },
  );
});
