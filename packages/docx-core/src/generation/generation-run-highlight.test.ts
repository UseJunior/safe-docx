import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { childElements, getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { OOXML } from '../primitives/namespaces.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-run-highlight';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

async function loadDocumentXml(buffer: Buffer): Promise<{ xml: string; dom: Document }> {
  const xml = await readZipText(buffer, 'word/document.xml');
  expect(xml, 'word/document.xml missing from package').not.toBeNull();
  return { xml: xml!, dom: parseXml(xml!) };
}

function wChildNames(el: Element): string[] {
  return childElements(el)
    .filter((child) => child.namespaceURI === OOXML.W_NS)
    .map((child) => child.localName);
}

function highlightValues(dom: Document): string[] {
  return Array.from(dom.getElementsByTagName('w:highlight')).map((el) => el.getAttribute('w:val') ?? '');
}

function runHighlightSpec(): DocumentSpec {
  return {
    sections: [
      {
        blocks: [
          {
            kind: 'paragraph',
            runs: [
              {
                kind: 'text',
                text: '{employer_name}',
                colorHex: '1F4E79',
                sizePt: 12,
                highlight: 'yellow',
                underline: 'single',
              },
              { kind: 'text', text: ' cleared', highlight: 'none' },
            ],
          },
        ],
      },
    ],
  };
}

describe('Traceability: run highlight generation', () => {
  test.openspec('[SDX-GEN-105] highlighted runs emit ordered highlight properties')(
    'Scenario: highlighted runs emit ordered highlight properties',
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a spec with runs carrying enumerated highlight values', async () => {
        buffer = await generateDocx(runHighlightSpec());
      });

      let documentXml!: string;
      let documentDoc!: Document;
      let firstRPr!: Element;
      await when('word/document.xml is parsed from the generated package', async () => {
        ({ xml: documentXml, dom: documentDoc } = await loadDocumentXml(buffer));
        await attachPrettyXml('word/document.xml', documentXml);
        const firstRun = documentDoc.getElementsByTagName('w:r').item(0)!;
        firstRPr = getDirectChildrenByName(firstRun, 'rPr')[0]!;
        expect(firstRPr).toBeTruthy();
      });

      await then('the authored highlight values are emitted as run properties', async () => {
        expect(documentXml).toContain('<w:highlight w:val="yellow"/>');
        expect(highlightValues(documentDoc)).toEqual(['yellow', 'none']);
      });

      await then('highlight is ordered after size/color properties and before underline', async () => {
        const names = wChildNames(firstRPr);
        await attachPrettyJson('rpr-child-order', names);
        expect(names).toEqual(['color', 'sz', 'szCs', 'highlight', 'u']);
      });

      await then('the generated package is structurally valid and well-formed', async () => {
        const structural = await checkGeneratedPackage(buffer);
        await attachPrettyJson('structural-check-result', structural);
        expect(structural.issues).toEqual([]);
        expect(parseXml(documentXml).getElementsByTagName('w:highlight')).toHaveLength(2);
      });

      await then('the highlight properties survive a load/save round-trip', async () => {
        const loaded = await DocxDocument.load(buffer);
        const saved = await loaded.toBuffer();
        const { dom: savedDoc } = await loadDocumentXml(saved.buffer);
        expect(highlightValues(savedDoc)).toEqual(['yellow', 'none']);
      });
    },
  );
});
