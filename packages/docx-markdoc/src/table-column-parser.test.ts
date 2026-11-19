import { expect } from 'vitest';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { parseMarkdoc, requireMarkdoc } from './markdoc.js';

const TEST_FEATURE = 'add-markdoc-table-columns';
const test = testAllure.epic('DOCX Markdoc').withLabels({ feature: TEST_FEATURE });
const source = `{% source sha256="${'0'.repeat(64)}" paragraphs=0 /%}\n`;
const column = (attributes = '', cells = '{% column-cell text="Response" /%}') =>
  source + `{% insert-table-column anchor="_bk_table" width-twips=1800 edit="responses" ${attributes} %}\n${cells}\n{% /insert-table-column %}`;

test('parses appended and indexed columns with empty and multiple-paragraph cells', () => {
  expect(requireMarkdoc(column('', '{% column-cell text="" /%}')).operations).toEqual([{
    kind: 'insert-table-column', operationId: 'responses', anchorId: '_bk_table', widthTwips: 1800, cells: [['']],
  }]);
  expect(requireMarkdoc(column('column-index=0 landscape=true', [
    '{% column-cell text="Response" /%}',
    '{% column-cell %}', 'First paragraph', 'wraps here.', '', 'Second paragraph.', '{% /column-cell %}',
  ].join('\n'))).operations).toEqual([{
    kind: 'insert-table-column', operationId: 'responses', anchorId: '_bk_table', widthTwips: 1800,
    columnIndex: 0, landscape: true, cells: [['Response'], ['First paragraph wraps here.', 'Second paragraph.']],
  }]);
});

test.openspec('[SDX-MDOC-COLUMN-03] ambiguous or unsupported column requests fail before output')(
  'rejects invalid widths, indices and cell syntax without discarding authored content', () => {
    for (const authored of [
      column().replace('width-twips=1800', 'width-twips=0'),
      column().replace('width-twips=1800', 'width-twips=1.5'),
      column().replace('width-twips=1800', 'width-twips=9007199254740992'),
      column('column-index=-1'), column('column-index=0.5'), column('landscape="true"'),
      column().replace('edit="responses"', ''), column().replace('edit="responses"', 'edit=""'),
      column().replace('anchor="_bk_table"', ''),
      ...['![Lost](https://example.com/a.png)', '---', '> ', '```\n\n```'].map(block =>
        column('', block + '\n{% column-cell text="Response" /%}')),
      column('', ''), column('', 'Stray prose.'), column('', '{% cell text="Wrong child" /%}'),
      column('', '{% column-cell /%}'),
      column('', '{% column-cell text="One" %}Two{% /column-cell %}'),
      column('', '{% column-cell %}\n**Bold would be lost.**\n{% /column-cell %}'),
      column('', '{% column-cell %}\n[Link](https://example.com)\n{% /column-cell %}'),
      column('', '{% column-cell %}\n- A list\n{% /column-cell %}'),
      column('', '{% column-cell %}\nFirst\\\nsecond.\n{% /column-cell %}'),
      column().replace('edit="responses"', 'operation="responses"'),
      column() + '\n' + column().slice(source.length),
    ]) expect(parseMarkdoc(authored).valid, authored).toBe(false);
  },
);
