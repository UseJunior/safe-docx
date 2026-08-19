import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure } from '../../testing/allure-test.js';
import { compareFootnoteDefinitions } from './ancillaryNoteComparison.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Ancillary Note Comparison';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const serializer = new XMLSerializer();
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

function definition(runs: string[]): Element {
  const runXml = runs.map((text) => `<w:r><w:t>${text}</w:t></w:r>`).join('');
  return parseXml(
    `<w:footnote xmlns:w="${W_NS}" w:id="1"><w:p>${runXml}</w:p></w:footnote>`,
  ).documentElement;
}

function serialize(elements: readonly Element[]): string {
  return elements.map((element) => serializer.serializeToString(element)).join('');
}

describe('ancillary note comparison normalization', () => {
  test('premerges safely compatible adjacent runs before publishing unchanged definitions', () => {
    const result = compareFootnoteDefinitions(
      definition(['Stable ', 'footnote']),
      definition(['Stable ', 'footnote']),
      { author: 'Comparison', date: new Date('2026-08-18T12:00:00Z') },
    );
    const xml = serialize(result);

    expect(xml.match(/<w:r(?:\s|>)/gu)).toHaveLength(1);
    expect(xml).toContain('<w:t>Stable </w:t><w:t>footnote</w:t>');
    expect(xml).not.toContain('<w:ins');
    expect(xml).not.toContain('<w:del');
  });

  test('keeps fragmented note edits projection-safe without extra revision ranges', () => {
    const result = compareFootnoteDefinitions(
      definition(['Shared ', 'before']),
      definition(['Shared ', 'after']),
      { author: 'Comparison', date: new Date('2026-08-18T12:00:00Z') },
    );
    const xml = `<w:document xmlns:w="${W_NS}"><w:body>${serialize(result)}</w:body></w:document>`;

    expect(xml.match(/<w:ins(?:\s|>)/gu)).toHaveLength(1);
    expect(xml.match(/<w:del(?:\s|>)/gu)).toHaveLength(1);
    expect(acceptAllChanges(xml)).toContain('after');
    expect(acceptAllChanges(xml)).not.toContain('before');
    expect(rejectAllChanges(xml)).toContain('before');
    expect(rejectAllChanges(xml)).not.toContain('after');
  });
});
