import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { buildDocumentView } from '../src/primitives/document_view.js';
import { DocxDocument } from '../src/primitives/document.js';
import { createZipBuffer } from '../src/primitives/zip.js';

const TEST_FEATURE = 'add-deterministic-locator-primitive';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const BODY =
  `<w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Second [Insert Company Name] paragraph.</w:t></w:r></w:p>`;

function makeDocXml(bodyXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${OOXML.W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
}

async function makeDocxBuffer(bodyXml: string): Promise<Buffer> {
  return createZipBuffer({
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
    'word/document.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${OOXML.W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  });
}

describe('free buildDocumentView', () => {
  test.openspec('free function returns populated nodes')('Scenario: free function returns populated nodes', async ({ given, when, then }: AllureBddContext) => {
    let nodes: ReturnType<typeof buildDocumentView>['nodes'] = [];
    await given('a parsed document with inserted paragraph bookmarks', async () => {
      const doc = makeDocXml(BODY);
      insertParagraphBookmarks(doc, 'test');
      await when('the free buildDocumentView is called', async () => {
        nodes = buildDocumentView({ documentXml: doc, stylesXml: null, numberingXml: null }).nodes;
      });
    });
    await then('it is no longer an empty stub', async () => {
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.clean_text).toBe('First paragraph.');
      expect(nodes[1]!.clean_text).toBe('Second [Insert Company Name] paragraph.');
      expect(nodes.every((n) => n.id.startsWith('_bk_'))).toBe(true);
      // raw_text is populated so offset translation works downstream.
      expect(nodes[1]!.raw_text).toBe('Second [Insert Company Name] paragraph.');
    });
  });

  test.openspec('free function matches the method')('Scenario: free function matches the method', async ({ given, when, then }: AllureBddContext) => {
    let freeNodes: ReturnType<typeof buildDocumentView>['nodes'] = [];
    let methodNodes: ReturnType<typeof buildDocumentView>['nodes'] = [];
    await given('the same body built both ways with the same bookmark attachment id', async () => {
      const freeDoc = makeDocXml(BODY);
      insertParagraphBookmarks(freeDoc, 'test');
      freeNodes = buildDocumentView({ documentXml: freeDoc, stylesXml: null, numberingXml: null }).nodes;

      const buf = await makeDocxBuffer(BODY);
      const doc = await DocxDocument.load(buf);
      doc.insertParagraphBookmarks('test');
      methodNodes = doc.buildDocumentView().nodes;
    });
    await then('the id + clean_text + raw_text projections are identical', async () => {
      const project = (ns: typeof freeNodes) => ns.map((n) => ({ id: n.id, clean_text: n.clean_text, raw_text: n.raw_text }));
      expect(project(freeNodes)).toEqual(project(methodNodes));
    });
    void when;
  });
});
