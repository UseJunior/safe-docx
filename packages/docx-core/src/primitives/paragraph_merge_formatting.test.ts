import { readFileSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';

const TEST_FEATURE = 'repair-paragraph-merge-formatting';
const test = testAllure.withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;

describe('paragraph merge formatting', () => {
  test.openspec('Selective merge retains following pending property history')('preserves following property history during selective-author accept and reject', () => {
    for (const [tag, resolve] of [['del', acceptChanges], ['ins', rejectChanges]] as const) {
      const doc = parseXml(wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:${tag} w:id="1" w:author="T"/></w:rPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/><w:rPrChange w:id="7" w:author="Other"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:pPrChange w:id="8" w:author="Other"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>B</w:t></w:r></w:p>`));
      resolve(doc, { filter: element => element.getAttributeNS(W, 'author') === 'T' });
      expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(1);
      for (const name of ['pPrChange', 'rPrChange']) {
        const records = doc.getElementsByTagNameNS(W, name);
        expect(records).toHaveLength(1);
        expect(records[0]!.getAttributeNS(W, 'author')).toBe('Other');
      }
      expect(doc.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('right');
    }
  });
  test.openspec('Merge formatting differs from the existing following-mark assumption')('retains leading formatting for surviving content on both projections', () => {
    for (const [tag, resolve] of [['del', acceptChanges], ['ins', rejectChanges]] as const) {
      const doc = parseXml(wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:${tag} w:id="1" w:author="T"/></w:rPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>B</w:t></w:r></w:p>`));
      resolve(doc);
      expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(1);
      expect(doc.getElementsByTagNameNS(W, 'p')[0]!.textContent).toBe('AB');
      expect(doc.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('right');
    }
  });
  test.openspec('Untracked empty paragraph remains')('never removes an untracked paragraph when run content disappears', () => {
    for (const [tag, resolve] of [['del', acceptChanges], ['ins', rejectChanges]] as const) {
      const doc = parseXml(wrap(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:${tag} w:id="1" w:author="T"><w:r><w:${tag === 'del' ? 'delText' : 't'}>A</w:${tag === 'del' ? 'delText' : 't'}></w:r></w:${tag}></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>`));
      resolve(doc);
      expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(2);
      expect(doc.getElementsByTagNameNS(W, 'p')[0]!.textContent).toBe('');
      expect(doc.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('right');
    }
  });
  test.openspec('Reader evidence does not establish Word behavior')('keeps the documented Word evidence limitation explicit', () => {
    const evidence = readFileSync(new URL('../../../../openspec/changes/archive/2026-09-17-repair-paragraph-merge-formatting/evidence.md', import.meta.url), 'utf8');
    expect(evidence).toContain('Word is UNVERIFIED');
    expect(evidence).toContain('LibreOffice 26.2.5.2');
    const matrixRows = evidence.split('\n').filter(line => /^\| (Accept|Reject) \|/.test(line));
    expect(matrixRows).toHaveLength(8);
    expect(matrixRows.every(line => line.endsWith('| UNVERIFIED |'))).toBe(true);
  });
});
