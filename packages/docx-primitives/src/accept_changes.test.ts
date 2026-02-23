import { describe, expect } from 'vitest';
import { acceptChanges } from './accept_changes.js';
import { parseXml, serializeXml } from './xml.js';
import { itAllure, allureStep, allureJsonAttachment } from '../test/helpers/allure-test.js';

const TEST_FEATURE = 'add-accept-tracked-changes';
const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const humanReadableIt = it.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wrapBodyXml(bodyXml: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<w:document xmlns:w="${W_NS}">`,
    `<w:body>${bodyXml}</w:body>`,
    '</w:document>',
  ].join('');
}

function runAcceptChanges(bodyXml: string): { xml: string; summary: ReturnType<typeof acceptChanges> } {
  const doc = parseXml(wrapBodyXml(bodyXml));
  const summary = acceptChanges(doc);
  const xml = serializeXml(doc);
  return { xml, summary };
}

describe('Traceability: Accept Tracked Changes', () => {
  humanReadableIt.openspec('accept insertions by unwrapping w:ins wrappers')(
    'accept insertions by unwrapping w:ins wrappers',
    async () => {
      const input = '<w:p><w:ins><w:r><w:t>Inserted text</w:t></w:r></w:ins></w:p>';

      const result = await allureStep('accept insertions and unwrap wrappers', async () => runAcceptChanges(input));
      await allureJsonAttachment('accept-insertions-result', result);

      expect(result.summary.insertionsAccepted).toBe(1);
      expect(result.xml.includes('<w:ins')).toBe(false);
      expect(result.xml.includes('Inserted text')).toBe(true);
    },
  );

  humanReadableIt.openspec('accept deletions by removing w:del elements and content')(
    'accept deletions by removing w:del elements and content',
    async () => {
      const input = [
        '<w:p>',
        '<w:r><w:t>Keep</w:t></w:r>',
        '<w:del><w:r><w:delText>Drop me</w:delText></w:r></w:del>',
        '</w:p>',
      ].join('');

      const result = await allureStep('accept deletions and drop removed content', async () => runAcceptChanges(input));
      await allureJsonAttachment('accept-deletions-result', result);

      expect(result.summary.deletionsAccepted).toBe(1);
      expect(result.xml.includes('<w:del')).toBe(false);
      expect(result.xml.includes('Drop me')).toBe(false);
      expect(result.xml.includes('Keep')).toBe(true);
    },
  );

  humanReadableIt.openspec('accept property changes by removing change records')(
    'accept property changes by removing change records',
    async () => {
      const input = [
        '<w:p>',
        '<w:r>',
        '<w:rPr><w:rPrChange w:id="1" w:author="test"/></w:rPr>',
        '<w:t>Stable text</w:t>',
        '</w:r>',
        '</w:p>',
      ].join('');

      const result = await allureStep('remove rPr/pPr/tbl/tr/tc change records', async () => runAcceptChanges(input));
      await allureJsonAttachment('accept-property-changes-result', result);

      expect(result.summary.propertyChangesResolved).toBe(1);
      expect(result.xml.includes('rPrChange')).toBe(false);
      expect(result.xml.includes('Stable text')).toBe(true);
    },
  );

  humanReadableIt.openspec('accept moves by keeping destination and removing source')(
    'accept moves by keeping destination and removing source',
    async () => {
      const input = [
        '<w:p>',
        '<w:moveFrom w:id="11"><w:r><w:t>Old location</w:t></w:r></w:moveFrom>',
        '<w:moveTo w:id="11"><w:r><w:t>New location</w:t></w:r></w:moveTo>',
        '</w:p>',
      ].join('');

      const result = await allureStep('resolve move wrappers into destination-only text', async () => runAcceptChanges(input));
      await allureJsonAttachment('accept-moves-result', result);

      expect(result.summary.movesResolved).toBe(2);
      expect(result.xml.includes('<w:moveFrom')).toBe(false);
      expect(result.xml.includes('<w:moveTo')).toBe(false);
      expect(result.xml.includes('Old location')).toBe(false);
      expect(result.xml.includes('New location')).toBe(true);
    },
  );

  humanReadableIt.openspec('bottom-up processing resolves nested revisions')(
    'bottom-up processing resolves nested revisions',
    async () => {
      const input = [
        '<w:p>',
        '<w:ins>',
        '<w:r><w:t>Start </w:t></w:r>',
        '<w:del><w:r><w:delText>remove-me</w:delText></w:r></w:del>',
        '<w:r><w:t>end</w:t></w:r>',
        '</w:ins>',
        '</w:p>',
      ].join('');

      const result = await allureStep('unwrap nested insertions while removing nested deletions', async () => runAcceptChanges(input));
      await allureJsonAttachment('accept-nested-revisions-result', result);

      expect(result.xml.includes('<w:ins')).toBe(false);
      expect(result.xml.includes('<w:del')).toBe(false);
      expect(result.xml.includes('remove-me')).toBe(false);
      expect(result.xml.includes('Start ')).toBe(true);
      expect(result.xml.includes('end')).toBe(true);
    },
  );

  humanReadableIt.openspec('orphaned moves handled with safe fallback')(
    'orphaned moves handled with safe fallback',
    async () => {
      const input = [
        '<w:p>',
        '<w:moveFromRangeStart w:id="91"/>',
        '<w:moveFrom w:id="91"><w:r><w:t>Orphan source</w:t></w:r></w:moveFrom>',
        '<w:r><w:t>Still here</w:t></w:r>',
        '<w:moveFromRangeEnd w:id="91"/>',
        '</w:p>',
      ].join('');

      const result = await allureStep('remove orphaned move wrappers without throwing', async () => runAcceptChanges(input));
      await allureJsonAttachment('accept-orphaned-moves-result', result);

      expect(result.summary.movesResolved).toBe(1);
      expect(result.xml.includes('moveFromRangeStart')).toBe(false);
      expect(result.xml.includes('moveFromRangeEnd')).toBe(false);
      expect(result.xml.includes('Orphan source')).toBe(false);
      expect(result.xml.includes('Still here')).toBe(true);
    },
  );
});
