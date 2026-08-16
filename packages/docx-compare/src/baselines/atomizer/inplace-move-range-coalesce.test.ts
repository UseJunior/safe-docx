/**
 * Regression coverage for one move-range pair per logical move.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/446
 */

import { buildSyntheticDocx, parseXml, serializeXml } from '@usejunior/docx-core';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { coalesceMoveRangeMarkers } from './inPlaceModifier-postprocess.js';
// The preserved-move fixture pre-tracks both inputs, which the public
// comparison boundary now refuses (issue #742); the identity-collision
// behavior under test lives below that guard.
import { compareDocumentsAtomizerUnguarded } from './pipeline.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../../testing/ooxml-fixtures.js';

const TEST_FEATURE = 'Inplace Move-Range Coalescing';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.23' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.24' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.27' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.28' });

const MOVED_PARAGRAPH = 'The quick brown fox jumps over the lazy dog today';

function countTag(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag.replace(':', '\\:')}\\b`, 'g')) ?? []).length;
}

async function documentXml(docx: Buffer): Promise<string> {
  const part = (await JSZip.loadAsync(docx)).file('word/document.xml');
  if (!part) throw new Error('comparison result omitted word/document.xml');
  return part.async('string');
}

describe('Inplace move-range marker coalescing', () => {
  test.openspec('[MOVE-RANGE-PAIR-01] Inplace emission produces one range pair per logical move')(
    'whole-paragraph move emits exactly one range pair per side despite run fragmentation', async ({
      given,
      when,
      then,
      and,
    }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result!: Awaited<ReturnType<typeof compareDocuments>>;
      let xml!: string;

      await given('a three-paragraph document where the first paragraph moves to the end', async () => {
        original = await buildSyntheticDocx({
          paragraphs: [MOVED_PARAGRAPH, 'Middle paragraph stays put', 'Final paragraph also stays'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['Middle paragraph stays put', 'Final paragraph also stays', MOVED_PARAGRAPH],
        });
      });

      await when('the documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
        xml = await documentXml(result.document);
      });

      await then('inplace reconstruction is used', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
      });

      await and('exactly one source and destination range pair brackets the move', () => {
        expect(countTag(xml, 'w:moveFromRangeStart')).toBe(1);
        expect(countTag(xml, 'w:moveFromRangeEnd')).toBe(1);
        expect(countTag(xml, 'w:moveToRangeStart')).toBe(1);
        expect(countTag(xml, 'w:moveToRangeEnd')).toBe(1);
        expect(countTag(xml, 'w:moveFrom')).toBeGreaterThan(1);
      });

      await and('each end reuses its start id and both directions share one move name', () => {
        const fromStart = xml.match(/<w:moveFromRangeStart\s+w:id="([^"]+)"\s+w:name="([^"]+)"/);
        const fromEnd = xml.match(/<w:moveFromRangeEnd\s+w:id="([^"]+)"/);
        const toStart = xml.match(/<w:moveToRangeStart\s+w:id="([^"]+)"\s+w:name="([^"]+)"/);
        const toEnd = xml.match(/<w:moveToRangeEnd\s+w:id="([^"]+)"/);
        expect(fromStart).not.toBeNull();
        expect(fromEnd?.[1]).toBe(fromStart?.[1]);
        expect(toStart).not.toBeNull();
        expect(toEnd?.[1]).toBe(toStart?.[1]);
        expect(toStart?.[2]).toBe(fromStart?.[2]);
        expect(toStart?.[1]).not.toBe(fromStart?.[1]);
      });
    });

  describe('preserved move identity collision', () => {
    test.openspec('[MOVE-RANGE-PAIR-01] Inplace emission produces one range pair per logical move')(
    'seeds preserved range IDs and names before an end-to-end compare and certificate check', async () => {
      const preservedMove =
        '<w:p><w:moveFromRangeStart w:id="1" w:name="move1" w:author="Existing" ' +
        'w:date="2026-07-20T00:00:00Z"/><w:moveFrom w:id="2" w:author="Existing">' +
        '<w:r><w:delText>Preserved move</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="1"/></w:p>' +
        '<w:p><w:moveToRangeStart w:id="3" w:name="move1" w:author="Existing" ' +
        'w:date="2026-07-20T00:00:00Z"/><w:moveTo w:id="4" w:author="Existing">' +
        '<w:r><w:t>Preserved move</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="3"/></w:p>';
      const original = await buildDocxFromBodyXml(
        preservedMove + paragraphWithText(MOVED_PARAGRAPH) +
        paragraphWithText('Middle paragraph stays put') + paragraphWithText('Final paragraph stays put'),
      );
      const revised = await buildDocxFromBodyXml(
        preservedMove + paragraphWithText('Middle paragraph stays put') +
        paragraphWithText('Final paragraph stays put') + paragraphWithText(MOVED_PARAGRAPH),
      );

      const result = await compareDocumentsAtomizerUnguarded(original, revised, {
        reconstructionMode: 'inplace',
      });
      const xml = await documentXml(result.document);
      const starts = Array.from(parseXml(xml).getElementsByTagName('w:moveFromRangeStart'));
      const identities = starts.map((start) => ({
        id: start.getAttribute('w:id'),
        name: start.getAttribute('w:name'),
      }));

      expect(result.reconstructionModeUsed).toBe('inplace');
      expect(identities).toContainEqual({ id: '1', name: 'move1' });
      expect(identities.some(({ name }) => name === 'move2')).toBe(true);
      expect(identities.filter(({ name }) => name === 'move2').map(({ id }) => id))
        .not.toContain('1');
      expect(xml).toContain('w:moveToRangeStart w:id="3" w:name="move1"');
    });
  });

  test('one logical move spanning paragraphs keeps generated boundaries and preserves existing markers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let root!: Element;

    let generatedMarkers!: Set<Element>;

    await given('duplicate generated pairs plus an existing same-id pair across paragraphs', () => {
      root = parseXml(
        '<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:p><w:moveFromRangeStart w:id="7" w:name="move1"/><w:moveFrom w:id="8"/></w:p>' +
        '<w:p><w:moveFromRangeEnd w:id="7"/><w:moveFromRangeStart w:id="7" w:name="move1"/>' +
        '<w:moveFrom w:id="9"/><w:moveFromRangeEnd w:id="7"/></w:p>' +
        '<w:p><w:moveToRangeStart w:id="8" w:name="move1"/><w:moveTo w:id="10"/></w:p>' +
        '<w:p><w:moveToRangeEnd w:id="8"/><w:moveToRangeStart w:id="8" w:name="move1"/>' +
        '<w:moveTo w:id="11"/><w:moveToRangeEnd w:id="8"/></w:p>' +
        '<w:p><w:moveFromRangeStart w:id="7" w:name="existingMove"/>' +
        '<w:moveFrom w:id="12"/><w:moveFromRangeEnd w:id="7"/></w:p></w:body>',
      ).documentElement!;
      generatedMarkers = new Set([
        ...Array.from(root.getElementsByTagName('w:moveFromRangeStart')).slice(0, 2),
        ...Array.from(root.getElementsByTagName('w:moveFromRangeEnd')).slice(0, 2),
        ...Array.from(root.getElementsByTagName('w:moveToRangeStart')),
        ...Array.from(root.getElementsByTagName('w:moveToRangeEnd')),
      ]);
    });

    await when('the move-range postprocessor coalesces generated duplicates', () => {
      coalesceMoveRangeMarkers(root, generatedMarkers);
    });

    await then('the document contains one range spanning both paragraphs', () => {
      const xml = serializeXml(root.ownerDocument!);
      expect(countTag(xml, 'w:moveFromRangeStart')).toBe(2);
      expect(countTag(xml, 'w:moveFromRangeEnd')).toBe(2);
      expect(countTag(xml, 'w:moveToRangeStart')).toBe(1);
      expect(countTag(xml, 'w:moveToRangeEnd')).toBe(1);
      expect(xml).toContain('w:name="existingMove"');
    });
  });
});
