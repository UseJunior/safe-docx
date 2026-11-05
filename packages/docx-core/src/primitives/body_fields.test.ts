import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildBodyFieldRuns, groupBodyFieldRuns } from './body_fields.js';
import { OOXML } from './namespaces.js';
import { parseXml } from './xml.js';

const TEST_FEATURE = 'Footnote and comment body fields';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

const W_NS = OOXML.W_NS;

describe('body field runs', () => {
  test('groups consecutive runs of one field and keeps other runs apart', () => {
    const ref = { instruction: ' REF price \\w \\h ', key: '0' };
    const groups = groupBodyFieldRuns([
      { text: 'See ' },
      { text: 'Section ', field: ref },
      { text: '1.01', field: { ...ref } },
      { text: 'Section 2', field: { instruction: ref.instruction, key: '1' } },
      { text: '.' },
      { text: '!' },
    ]);
    expect(groups.map((group) => [group.field?.key ?? null, group.runs.map((run) => run.text).join('|')])).toEqual([
      [null, 'See '],
      ['0', 'Section |1.01'],
      ['1', 'Section 2'],
      [null, '.'],
      [null, '!'],
    ]);
  });

  test('refuses a field run that is also a hyperlink run, and a field without an instruction', () => {
    expect(() => groupBodyFieldRuns([{ text: 'x', field: { instruction: ' REF a \\h ' }, hyperlink: { destination: 'https://example.com' } }]))
      .toThrow('A body field run cannot also be a hyperlink run');
    expect(() => groupBodyFieldRuns([{ text: 'x', field: {} as { instruction: string } }])).toThrow('A body field needs an instruction');
  });

  test('wraps result runs in begin, instruction, separate and end runs carrying the first result run\'s properties', () => {
    const doc = parseXml(`<w:p xmlns:w="${W_NS}"/>`);
    const result = (text: string, rPr = '') => parseXml(`<w:r xmlns:w="${W_NS}">${rPr}<w:t>${text}</w:t></w:r>`).documentElement as Element;
    const runs = buildBodyFieldRuns(doc, ' REF price \\w \\h ', [result('Section 1.01', '<w:rPr><w:sz w:val="20"/></w:rPr>'), result('(b)')]);
    // Each run as its children: a run-properties marker, then the field character type, instruction or text.
    const shape = runs.map((run) => Array.from(run.childNodes).map((child) => {
      const element = child as Element;
      if (element.localName === 'rPr') return `rPr:${element.getElementsByTagNameNS(W_NS, 'sz')[0]?.getAttributeNS(W_NS, 'val')}`;
      if (element.localName === 'fldChar') return `fldChar:${element.getAttributeNS(W_NS, 'fldCharType')}`;
      if (element.localName === 'instrText') return `instrText:${element.getAttribute('xml:space')}:${element.textContent}`;
      return `${element.localName}:${element.textContent}`;
    }));
    expect(shape).toEqual([
      ['rPr:20', 'fldChar:begin'],
      ['rPr:20', 'instrText:preserve: REF price \\w \\h '],
      ['rPr:20', 'fldChar:separate'],
      ['rPr:20', 't:Section 1.01'],
      ['t:(b)'],
      ['rPr:20', 'fldChar:end'],
    ]);
    expect(() => buildBodyFieldRuns(doc, ' REF price \\h ', [])).toThrow('A body field needs at least one result run');
  });
});
