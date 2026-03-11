import { describe, expect } from 'vitest';
import { acceptChanges } from '../src/primitives/accept_changes.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Accept Changes' });
const humanReadableTest = test.allure({
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
  humanReadableTest.openspec('accept insertions by unwrapping w:ins wrappers')(
    'accept insertions by unwrapping w:ins wrappers',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const input = '<w:p><w:ins><w:r><w:t>Inserted text</w:t></w:r></w:ins></w:p>';

      let result: { xml: string; summary: ReturnType<typeof acceptChanges> };

      await given('a document with an inserted text run', async () => {});

      await when('insertions are accepted and wrappers unwrapped', async () => {
        result = runAcceptChanges(input);
        await attachPrettyJson('accept-insertions-result', result);
      });

      await then('one insertion is accepted', async () => {
        expect(result.summary.insertionsAccepted).toBe(1);
      });

      await and('w:ins wrappers are removed', async () => {
        expect(result.xml.includes('<w:ins')).toBe(false);
      });

      await and('the inserted text is preserved', async () => {
        expect(result.xml.includes('Inserted text')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('accept deletions by removing w:del elements and content')(
    'accept deletions by removing w:del elements and content',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const input = [
        '<w:p>',
        '<w:r><w:t>Keep</w:t></w:r>',
        '<w:del><w:r><w:delText>Drop me</w:delText></w:r></w:del>',
        '</w:p>',
      ].join('');

      let result: { xml: string; summary: ReturnType<typeof acceptChanges> };

      await given('a document with kept text and deleted text', async () => {});

      await when('deletions are accepted and removed content dropped', async () => {
        result = runAcceptChanges(input);
        await attachPrettyJson('accept-deletions-result', result);
      });

      await then('one deletion is accepted', async () => {
        expect(result.summary.deletionsAccepted).toBe(1);
      });

      await and('w:del wrappers are removed', async () => {
        expect(result.xml.includes('<w:del')).toBe(false);
      });

      await and('deleted text is removed from output', async () => {
        expect(result.xml.includes('Drop me')).toBe(false);
      });

      await and('kept text is preserved', async () => {
        expect(result.xml.includes('Keep')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('accept property changes by removing change records')(
    'accept property changes by removing change records',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const input = [
        '<w:p>',
        '<w:r>',
        '<w:rPr><w:rPrChange w:id="1" w:author="test"/></w:rPr>',
        '<w:t>Stable text</w:t>',
        '</w:r>',
        '</w:p>',
      ].join('');

      let result: { xml: string; summary: ReturnType<typeof acceptChanges> };

      await given('a document with a run property change record', async () => {});

      await when('property changes are accepted', async () => {
        result = runAcceptChanges(input);
        await attachPrettyJson('accept-property-changes-result', result);
      });

      await then('one property change is resolved', async () => {
        expect(result.summary.propertyChangesResolved).toBe(1);
      });

      await and('rPrChange elements are removed', async () => {
        expect(result.xml.includes('rPrChange')).toBe(false);
      });

      await and('stable text is preserved', async () => {
        expect(result.xml.includes('Stable text')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('accept moves by keeping destination and removing source')(
    'accept moves by keeping destination and removing source',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const input = [
        '<w:p>',
        '<w:moveFrom w:id="11"><w:r><w:t>Old location</w:t></w:r></w:moveFrom>',
        '<w:moveTo w:id="11"><w:r><w:t>New location</w:t></w:r></w:moveTo>',
        '</w:p>',
      ].join('');

      let result: { xml: string; summary: ReturnType<typeof acceptChanges> };

      await given('a document with move-from and move-to wrappers', async () => {});

      await when('moves are resolved into destination-only text', async () => {
        result = runAcceptChanges(input);
        await attachPrettyJson('accept-moves-result', result);
      });

      await then('two move wrappers are resolved', async () => {
        expect(result.summary.movesResolved).toBe(2);
      });

      await and('moveFrom wrappers are removed', async () => {
        expect(result.xml.includes('<w:moveFrom')).toBe(false);
      });

      await and('moveTo wrappers are removed', async () => {
        expect(result.xml.includes('<w:moveTo')).toBe(false);
      });

      await and('old location text is removed', async () => {
        expect(result.xml.includes('Old location')).toBe(false);
      });

      await and('new location text is preserved', async () => {
        expect(result.xml.includes('New location')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('bottom-up processing resolves nested revisions')(
    'bottom-up processing resolves nested revisions',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const input = [
        '<w:p>',
        '<w:ins>',
        '<w:r><w:t>Start </w:t></w:r>',
        '<w:del><w:r><w:delText>remove-me</w:delText></w:r></w:del>',
        '<w:r><w:t>end</w:t></w:r>',
        '</w:ins>',
        '</w:p>',
      ].join('');

      let result: { xml: string; summary: ReturnType<typeof acceptChanges> };

      await given('a document with nested insertions and deletions', async () => {});

      await when('nested revisions are unwrapped bottom-up', async () => {
        result = runAcceptChanges(input);
        await attachPrettyJson('accept-nested-revisions-result', result);
      });

      await then('w:ins wrappers are removed', async () => {
        expect(result.xml.includes('<w:ins')).toBe(false);
      });

      await and('w:del wrappers are removed', async () => {
        expect(result.xml.includes('<w:del')).toBe(false);
      });

      await and('nested deleted text is removed', async () => {
        expect(result.xml.includes('remove-me')).toBe(false);
      });

      await and('start text is preserved', async () => {
        expect(result.xml.includes('Start ')).toBe(true);
      });

      await and('end text is preserved', async () => {
        expect(result.xml.includes('end')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('orphaned moves handled with safe fallback')(
    'orphaned moves handled with safe fallback',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const input = [
        '<w:p>',
        '<w:moveFromRangeStart w:id="91"/>',
        '<w:moveFrom w:id="91"><w:r><w:t>Orphan source</w:t></w:r></w:moveFrom>',
        '<w:r><w:t>Still here</w:t></w:r>',
        '<w:moveFromRangeEnd w:id="91"/>',
        '</w:p>',
      ].join('');

      let result: { xml: string; summary: ReturnType<typeof acceptChanges> };

      await given('a document with orphaned move wrappers', async () => {});

      await when('orphaned move wrappers are removed without throwing', async () => {
        result = runAcceptChanges(input);
        await attachPrettyJson('accept-orphaned-moves-result', result);
      });

      await then('one move is resolved', async () => {
        expect(result.summary.movesResolved).toBe(1);
      });

      await and('moveFromRangeStart is removed', async () => {
        expect(result.xml.includes('moveFromRangeStart')).toBe(false);
      });

      await and('moveFromRangeEnd is removed', async () => {
        expect(result.xml.includes('moveFromRangeEnd')).toBe(false);
      });

      await and('orphan source text is removed', async () => {
        expect(result.xml.includes('Orphan source')).toBe(false);
      });

      await and('non-orphan text is preserved', async () => {
        expect(result.xml.includes('Still here')).toBe(true);
      });
    },
  );
});
