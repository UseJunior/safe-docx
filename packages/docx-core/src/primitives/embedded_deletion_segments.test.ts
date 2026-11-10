import { afterEach, describe, expect, vi } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildDocxFromBodyXml, resultText } from '../testing/ooxml-fixtures.js';
import * as paragraphIndex from './paragraph-index.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { OOXML } from './namespaces.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { getParagraphText, replaceParagraphTextRange } from './text.js';
import { parseXml, serializeXml } from './xml.js';
import { DocxZip } from './zip.js';

const TEST_FEATURE = 'refactor-embedded-deletion-segments';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
  );
const trackedContext = () => createRevisionContext({
  author: 'Range test', date: '2026-11-07T12:00:00Z', idState: createRevisionIdState(),
});
const firstParagraph = (doc: Document) => doc.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0)!;

async function fixture(content: string) {
  const zip = await DocxZip.load(await buildDocxFromBodyXml(`<w:p>${content}</w:p>`));
  const doc = parseXml(await zip.readText('word/document.xml'));
  return { zip, doc, p: firstParagraph(doc) };
}

// Compare every character and identified object in document order, independently
// of run splitting/merging. Object subtrees must also survive byte-for-byte.
function contentOrder(root: Node): string[] {
  const out: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.namespaceURI === OOXML.W_NS) {
      if (['drawing', 'pict', 'object', 'contentPart'].includes(el.localName)) {
        out.push(new XMLSerializer().serializeToString(el));
        return;
      }
      if (el.localName === 't') {
        out.push(...(el.textContent ?? ''));
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return out;
}

async function reopen(zip: DocxZip, doc: Document): Promise<Document> {
  zip.writeText('word/document.xml', serializeXml(doc));
  const loaded = await DocxZip.load(await zip.toBuffer());
  return parseXml(await loaded.readText('word/document.xml'));
}

afterEach(() => vi.restoreAllMocks());

describe('replacement endpoint validation before any DOM write (#1312)', () => {
  for (const invalid of ['reversed', 'detached start', 'detached end', 'non-sibling', 'unreachable end'] as const) {
    test.openspec('Inconsistent endpoints fail without partial mutation')(`refuses ${invalid} indexed endpoints without changing the entire DOM`, async ({ given, when, then }: AllureBddContext) => {
      const { doc, p } = await fixture(resultText('Alpha') + resultText('Bravo'));
      const index = paragraphIndex.buildParagraphIndex(p);
      await given('an inconsistent run index injected at the read boundary', () => {
        if (invalid === 'reversed') index.runs.reverse();
        if (invalid === 'detached start') p.removeChild(index.runs[0]!.element);
        if (invalid === 'detached end') p.removeChild(index.runs[1]!.element);
        if (invalid === 'non-sibling') {
          const wrapper = doc.createElementNS(OOXML.W_NS, 'w:hyperlink');
          p.appendChild(wrapper);
          wrapper.appendChild(index.runs[1]!.element);
        }
        if (invalid === 'unreachable end') {
          // Same reported parent, but an end absent from the forward chain.
          Object.defineProperty(index.runs[0]!.element, 'nextSibling', { value: null, configurable: true });
        }
        vi.spyOn(paragraphIndex, 'buildParagraphIndex').mockReturnValue(index);
      });
      const before = serializeXml(doc);
      const writes = vi.spyOn(p, 'insertBefore');
      await when('a partial replacement would otherwise split both boundaries', () => {
        expect(() => replaceParagraphTextRange(p, 1, 9, 'X', trackedContext())).toThrow();
      });
      await then('validation precedes splitting and preserves all XML', () => {
        expect(writes).not.toHaveBeenCalled();
        expect(serializeXml(doc)).toBe(before);
      });
    });
  }

  for (const [start, end] of [[4, 2], [-1, 2], [0, 11]]) {
    test(`refuses invalid numeric range [${start}, ${end}) without mutation`, async ({ then }: AllureBddContext) => {
      const { doc, p } = await fixture(resultText('AlphaBravo'));
      const before = serializeXml(doc);
      await then('the original DOM survives the failed edit', () => {
        expect(() => replaceParagraphTextRange(p, start!, end!, 'X')).toThrow('Invalid range');
        expect(serializeXml(doc)).toBe(before);
      });
    });
  }
});

describe('local deletion segments preserve accepted/rejected DOCX order (#1312)', () => {
  // Small object subtrees isolate the text primitive's boundary behavior; these
  // are scenario XML, packaged with the shared DOCX fixture builder.
  const drawing = '<w:drawing><w:docPr w:id="1"/></w:drawing>';
  const pict = '<w:pict><w:shape w:id="2"/></w:pict>';
  const object = '<w:object w:id="3"/>';
  const contentPart = '<w:contentPart w:id="4"/>';
  const run = (xml: string) => `<w:r>${xml}</w:r>`;
  const cases = [
    { name: 'single run', xml: resultText('AlphaBravo'), start: 1, end: 9 },
    { name: 'text-only siblings', xml: resultText('Alpha') + resultText('Bravo'), start: 1, end: 9 },
    { name: 'zero-length insertion', xml: resultText('AlphaBravo'), start: 5, end: 5 },
    { name: 'objects at both outer edges', xml: run(drawing) + resultText('AlphaBravo') + run(pict), start: 0, end: 10 },
    { name: 'consecutive objects', xml: resultText('Alpha') + run(drawing) + run(pict) + resultText('Bravo'), start: 1, end: 9 },
    { name: 'text and multiple objects in one run', xml: run(`<w:t>Alpha</w:t>${drawing}<w:t>Middle</w:t>${pict}<w:t>Bravo</w:t>`), start: 1, end: 15 },
    { name: 'objects at mixed-run edges', xml: run(`${drawing}<w:t>AlphaBravo</w:t>${pict}`), start: 0, end: 10 },
    { name: 'objects between text and deletion fragments', xml: resultText('Alpha') + run(object) + resultText('Middle') + run(contentPart) + resultText('Bravo'), start: 1, end: 15 },
    { name: 'bookmark interrupts segments', xml: resultText('Alpha') + '<w:bookmarkStart w:id="8" w:name="anchor"/>' + run(drawing) + '<w:bookmarkEnd w:id="8"/>' + resultText('Bravo'), start: 1, end: 9 },
    { name: 'hyperlink', xml: `<w:hyperlink w:anchor="target">${resultText('Alpha')}${run(drawing)}${resultText('Bravo')}</w:hyperlink>`, start: 1, end: 9 },
    { name: 'nested supported wrappers', xml: `<w:sdt><w:sdtContent><w:hyperlink w:anchor="target">${resultText('Alpha')}${run(drawing)}${resultText('Bravo')}</w:hyperlink></w:sdtContent></w:sdt>`, start: 1, end: 9 },
  ];
  for (const scenario of cases) {
    test.openspec('A single-node range is reachable').openspec('Accept and reject survive DOCX serialization')(`${scenario.name}: accept matches clean editing and reject restores complete order after save/reopen`, async ({ given, when, then }: AllureBddContext) => {
      const { zip, doc, p } = await fixture(scenario.xml);
      const original = contentOrder(p);
      const originalText = getParagraphText(p);
      const clean = await fixture(scenario.xml);
      await given('an independently edited untracked reference', () => {
        replaceParagraphTextRange(clean.p, scenario.start, scenario.end, 'X');
      });
      await when('the same range is edited with tracked changes and saved/reopened', async () => {
        replaceParagraphTextRange(p, scenario.start, scenario.end, 'X', trackedContext());
      });
      const saved = await reopen(zip, doc);
      const accepted = parseXml(serializeXml(saved));
      const rejected = parseXml(serializeXml(saved));
      acceptChanges(accepted);
      rejectChanges(rejected);
      await then('both projections preserve every text character and object subtree in order', async () => {
        const acceptedAgain = await reopen(zip, accepted);
        const rejectedAgain = await reopen(zip, rejected);
        expect(getParagraphText(firstParagraph(acceptedAgain))).toBe(originalText.slice(0, scenario.start) + 'X' + originalText.slice(scenario.end));
        expect(contentOrder(firstParagraph(acceptedAgain))).toEqual(contentOrder(clean.p));
        expect(getParagraphText(firstParagraph(rejectedAgain))).toBe(originalText);
        expect(contentOrder(firstParagraph(rejectedAgain))).toEqual(original);
        expect(acceptedAgain.getElementsByTagNameNS(OOXML.W_NS, 'del').length).toBe(0);
        expect(rejectedAgain.getElementsByTagNameNS(OOXML.W_NS, 'ins').length).toBe(0);
      });
    });
  }
});
