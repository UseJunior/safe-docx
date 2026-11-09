/**
 * Inserting or deleting a body text box is a tracked object lifecycle, not an
 * unsupported topology: the anchor run is tracked, and the box's own story is
 * marked inserted or deleted with it. Boxes pair across the two documents by
 * anchor identity, so boxes that swap places never pair with each other.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/1031
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments, UnsupportedTextBoxRevisionError } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  assembleTextBoxStoryComparison,
  markTrackedTextBoxLifecycles,
} from './textBoxRevisionSafety.js';

const TEST_FEATURE = 'Text-Box Insertion and Deletion';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
  );

const W_NS = OOXML.W_NS;
const VML_NS = 'urn:schemas-microsoft-com:vml';
const NAMESPACES = {
  namespaces: {
    v: VML_NS,
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  },
  ignorablePrefixes: ['wps'],
} as const;
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** The issue's reproduction box: a VML text box with a shape id. */
const vmlBox = (text: string, id = 'tb1'): string =>
  `<w:p><w:r><w:pict><v:shape id="${id}" style="width:200pt;height:50pt">` +
  `<v:textbox><w:txbxContent>${para(text)}</w:txbxContent></v:textbox>` +
  `</v:shape></w:pict></w:r></w:p>`;

/** A Word 2010+ box: DrawingML choice and VML fallback of one object. */
const twinBox = (text: string, id: string): string =>
  `<w:p><w:r><mc:AlternateContent>` +
  `<mc:Choice Requires="wps"><w:drawing><wp:inline>` +
  `<wp:extent cx="2000000" cy="500000"/><wp:docPr id="${id}" name="Text Box ${id}"/>` +
  `<a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${para(text)}` +
  `</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:shape id="Text Box ${id}" style="width:200pt;height:50pt">` +
  `<v:textbox><w:txbxContent>${para(text)}</w:txbxContent></v:textbox>` +
  `</v:shape></w:pict></mc:Fallback>` +
  `</mc:AlternateContent></w:r></w:p>`;

const docx = (body: string): Promise<Buffer> => buildDocxFromBodyXml(body, [], NAMESPACES);
const documentXml = async (buffer: Buffer): Promise<string> =>
  (await DocxArchive.load(buffer)).getDocumentXml();

/** Each paragraph's visible text, text-box paragraphs included, in order. */
function paragraphTexts(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'p')).map((paragraph) =>
    Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'))
      .filter((text) => {
        // Text of a nested story belongs to that story's own paragraph.
        for (let node = text.parentNode; node && node !== paragraph; node = node.parentNode) {
          if ((node as Element).localName === 'txbxContent') return false;
        }
        return true;
      })
      .map((text) => text.textContent ?? '')
      .join(''),
  );
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-txbx-lifecycle-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Accept-all reproduces the revised text and reject-all the original, with both acceptors. */
async function assertProjections(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const expectedAccept = paragraphTexts(await documentXml(revised));
  const expectedReject = paragraphTexts(await documentXml(original));
  const output = await documentXml(compared);
  expect(paragraphTexts(acceptAllChanges(output))).toEqual(expectedAccept);
  expect(paragraphTexts(rejectAllChanges(output))).toEqual(expectedReject);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  expect(paragraphTexts(await documentXml((await accepted.toBuffer()).buffer))).toEqual(expectedAccept);
  expect(paragraphTexts(await documentXml((await rejected.toBuffer()).buffer))).toEqual(expectedReject);
}

/** The revision wrapper directly around a box's anchor run, if any. */
function anchorWrapper(textBox: Element): string | undefined {
  for (let node = textBox.parentNode; node; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI === W_NS && element.localName === 'r') {
      const parent = element.parentNode as Element;
      return parent.namespaceURI === W_NS && ['ins', 'del'].includes(parent.localName)
        ? parent.localName
        : undefined;
    }
  }
  return undefined;
}

/** Every story paragraph and text run of a box carries `kind`. */
function expectStoryMarked(textBox: Element, kind: 'ins' | 'del'): void {
  const paragraphs = Array.from(textBox.getElementsByTagNameNS(W_NS, 'p'));
  expect(paragraphs.length).toBeGreaterThan(0);
  for (const paragraph of paragraphs) {
    const markers = Array.from(paragraph.getElementsByTagNameNS(W_NS, kind)).filter(
      (marker) => (marker.parentNode as Element).localName === 'rPr',
    );
    expect(markers).toHaveLength(1);
    for (const run of Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'))) {
      expect((run.parentNode as Element).localName).toBe(kind);
    }
  }
}

function textBoxes(xml: string): Element[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'txbxContent'));
}

function shapeIdOf(textBox: Element): string | null {
  for (let node = textBox.parentNode; node; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI === VML_NS && element.localName === 'shape') {
      return element.getAttribute('id');
    }
  }
  return null;
}

describe('body text-box insertion and deletion', () => {
  test('tracks an inserted text box alongside a body edit (issue reproduction)', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('a body paragraph and one text box', () =>
      docx(para('Intro.') + vmlBox('Box one')));
    const revised = await given('an edited paragraph and a second, new text box', () =>
      docx(para('Intro, amended.') + vmlBox('Box one') + vmlBox('Box two', 'tb2')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('the body edit is tracked', () => {
      const inserted = Array.from(parseXml(output).getElementsByTagNameNS(W_NS, 'ins'))
        .map((element) => element.textContent ?? '');
      expect(inserted).toContain(', amended');
    });
    await and('the new box anchor is inserted and its story marked inserted', () => {
      const [unchanged, added] = textBoxes(output);
      expect(anchorWrapper(unchanged!)).toBeUndefined();
      expect(unchanged!.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
      expect(anchorWrapper(added!)).toBe('ins');
      expectStoryMarked(added!, 'ins');
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('tracks a deleted text box (deleted-box mirror)', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('a paragraph and two text boxes', () =>
      docx(para('Intro, amended.') + vmlBox('Box one') + vmlBox('Box two', 'tb2')));
    const revised = await given('an edited paragraph and the second box removed', () =>
      docx(para('Intro.') + vmlBox('Box one')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('the removed box anchor is deleted and its story marked deleted', () => {
      const removed = textBoxes(output).find((box) => shapeIdOf(box) === 'tb2')!;
      expect(anchorWrapper(removed)).toBe('del');
      expectStoryMarked(removed, 'del');
      expect(removed.getElementsByTagNameNS(W_NS, 't')).toHaveLength(0);
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('two boxes that swap order never pair with each other', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('box A then box B', () =>
      docx(para('Lead.') + vmlBox('Alpha notice', 'boxA') + vmlBox('Bravo notice', 'boxB')));
    const revised = await given('box B then box A, with A edited', () =>
      docx(para('Lead.') + vmlBox('Bravo notice', 'boxB') + vmlBox('Alpha notice, revised', 'boxA')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('every box holds only its own text', () => {
      for (const box of textBoxes(output)) {
        const text = box.textContent ?? '';
        if (shapeIdOf(box) === 'boxA') expect(text).not.toContain('Bravo');
        else expect(text).not.toContain('Alpha');
      }
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('an inserted box ahead of an edited box keeps the edit in its own story', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('one box', () =>
      docx(para('Lead.') + vmlBox('Notice to Acme', 'boxA')));
    const revised = await given('a new box first, then the original box edited', () =>
      docx(para('Lead.') + vmlBox('New notice', 'boxN') + vmlBox('Notice to Acme Inc.', 'boxA')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('the edited box carries an in-story redline under an untracked anchor', () => {
      const edited = textBoxes(output).find((box) => shapeIdOf(box) === 'boxA')!;
      expect(anchorWrapper(edited)).toBeUndefined();
      const inserted = Array.from(edited.getElementsByTagNameNS(W_NS, 'ins'))
        .map((element) => element.textContent ?? '').join('');
      expect(inserted).toContain(' Inc.');
    });
    await and('the new box is inserted whole', () => {
      const added = textBoxes(output).find((box) => shapeIdOf(box) === 'boxN')!;
      expect(anchorWrapper(added)).toBe('ins');
      expectStoryMarked(added, 'ins');
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('an inserted mc:AlternateContent box marks both stored copies', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('a twinned Word box', () =>
      docx(para('Lead.') + twinBox('Existing', '1')));
    const revised = await given('a second twinned Word box added', () =>
      docx(para('Lead.') + twinBox('Existing', '1') + twinBox('Added', '2')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('both stored copies of the new box are marked inserted', () => {
      const boxes = textBoxes(output);
      expect(boxes).toHaveLength(4);
      for (const box of boxes.slice(0, 2)) {
        expect(box.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
      }
      for (const box of boxes.slice(2)) {
        expect(anchorWrapper(box)).toBe('ins');
        expectStoryMarked(box, 'ins');
      }
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('a deleted mc:AlternateContent box marks both stored copies', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('two twinned Word boxes', () =>
      docx(para('Lead.') + twinBox('Removed', '7') + twinBox('Kept', '8')));
    const revised = await given('the first box removed', () =>
      docx(para('Lead.') + twinBox('Kept', '8')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('both stored copies of the removed box are marked deleted', () => {
      const boxes = textBoxes(output);
      expect(boxes).toHaveLength(4);
      for (const box of boxes.slice(0, 2)) {
        expect(anchorWrapper(box)).toBe('del');
        expectStoryMarked(box, 'del');
      }
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('a box whose identity changed is tracked as replaced, not redlined in place', async ({ given, when, then, and }: AllureBddContext) => {
    const original = await given('a box with one identity', () =>
      docx(para('Lead.') + vmlBox('Old address', 'boxOld')));
    const revised = await given('a different box in the same place', () =>
      docx(para('Lead.') + vmlBox('New address', 'boxNew')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('the old box is deleted and the new box inserted', () => {
      const boxes = textBoxes(output);
      expect(boxes.map((box) => [shapeIdOf(box), anchorWrapper(box)])).toEqual([
        ['boxOld', 'del'],
        ['boxNew', 'ins'],
      ]);
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
  });

  test('a changed box in a rewritten anchor paragraph keeps its in-story redline', async ({ given, when, then, and }: AllureBddContext) => {
    const anchored = (lead: string, story: string): string =>
      `<w:p><w:r><w:t>${lead}</w:t></w:r><w:r><w:pict><v:shape id="boxA" style="width:200pt;height:50pt">` +
      `<v:textbox><w:txbxContent>${para(story)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const original = await given('a box anchored in a paragraph', () =>
      docx(anchored('Notices shall be delivered by hand to the registered office', 'Acme Corp')));
    const revised = await given('the anchor paragraph rewritten and the box edited', () =>
      docx(anchored('Zebra quokka umbrella xylophone', 'Acme Corporation Ltd')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('the box keeps its anchor and carries the story redline', () => {
      expect(output).not.toContain('__safe_docx_text_box_story_');
      const [box] = textBoxes(output);
      expect(anchorWrapper(box!)).toBeUndefined();
      expect(box!.getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
  });

  test('an edited box whose anchor paragraph is relocated is tracked whole on both sides', async ({ given, when, then, and }: AllureBddContext) => {
    // The box pairs by identity and its story changed, but the body comparison
    // deletes and reinserts its relocated anchor paragraph. Each tracked anchor
    // receives that side's story, marked to match.
    const anchored = (story: string): string =>
      `<w:p><w:r><w:t>All notices under this agreement shall be delivered in writing to the address shown in the box</w:t></w:r>` +
      `<w:r><w:pict><v:shape id="boxA" style="width:200pt;height:50pt"><v:textbox><w:txbxContent>${para(story)}` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const others = para('Second paragraph stays here with plenty of words.') + para('Third paragraph also stays put with words.');
    const original = await given('the box paragraph first', () => docx(anchored('Acme Corp, 1 Main Street') + others));
    const revised = await given('the box paragraph last, with the box edited', () =>
      docx(others + anchored('Acme Corporation, 1 Main Street')));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const output = await documentXml(result.document);

    await then('the deleted anchor holds the original story and the inserted anchor the revised one', () => {
      expect(output).not.toContain('__safe_docx_text_box_story_');
      const boxes = textBoxes(output);
      expect(boxes).toHaveLength(2);
      const deleted = boxes.find((box) => anchorWrapper(box) === 'del')!;
      const inserted = boxes.find((box) => anchorWrapper(box) === 'ins')!;
      expect(deleted.textContent).toBe('Acme Corp, 1 Main Street');
      expectStoryMarked(deleted, 'del');
      expect(inserted.textContent).toBe('Acme Corporation, 1 Main Street');
      expectStoryMarked(inserted, 'ins');
    });
    await and('accept-all and reject-all reproduce both inputs', () =>
      assertProjections(original, revised, result.document));
    await and('the output passes the emitted-document schema gate', () => assertSchema(result.document));
  });

  test('a paired story whose anchor the outer comparison re-tracked receives each side whole', async ({ given, when, then, and }: AllureBddContext) => {
    // The outer comparison normally keeps a paired box's placeholder once. When
    // it instead deletes and reinserts the anchor, the splice must give the
    // deleted copy the original story and the inserted copy the revised one.
    const token = '__safe_docx_text_box_story_0__';
    const placeholderBox = (wrapper: 'ins' | 'del'): string =>
      `<w:p><w:${wrapper} w:id="${wrapper === 'del' ? 1 : 2}" w:author="Comparison" w:date="2026-01-01T00:00:00Z">` +
      `<w:r><w:pict><v:shape id="boxA" style="width:200pt;height:50pt"><v:textbox><w:txbxContent>` +
      `<w:p><w:r><w:${wrapper === 'del' ? 'delText' : 't'}>${token}</w:${wrapper === 'del' ? 'delText' : 't'}></w:r></w:p>` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:${wrapper}></w:p>`;
    const outer = await given('an outer comparison that re-tracked the placeholder anchor', () =>
      docx(placeholderBox('del') + placeholderBox('ins')));
    const originalStory = await given('the original story', () => docx(para('Old address')));
    const revisedStory = await given('the revised story', () => docx(para('New address')));

    const assembled = await when('the story is spliced and lifecycles marked', async () => {
      const spliced = await assembleTextBoxStoryComparison(outer, [{
        index: 0,
        visualIndex: 0,
        partPath: 'word/document.xml',
        container: 'textBox',
        document: revisedStory,
        original: originalStory,
        revised: revisedStory,
      }]);
      return (await markTrackedTextBoxLifecycles(spliced, 'Comparison', new Date('2026-01-01T00:00:00Z'))).document;
    });
    const output = await documentXml(assembled);

    await then('each tracked copy holds its own side, marked to match its anchor', () => {
      const [deleted, inserted] = textBoxes(output);
      expect(deleted!.textContent).toBe('Old address');
      expectStoryMarked(deleted!, 'del');
      expect(inserted!.textContent).toBe('New address');
      expectStoryMarked(inserted!, 'ins');
    });
    await and('accept-all keeps only the revised story and reject-all only the original', () => {
      expect(paragraphTexts(acceptAllChanges(output)).filter(Boolean)).toEqual(['New address']);
      expect(paragraphTexts(rejectAllChanges(output)).filter(Boolean)).toEqual(['Old address']);
    });
  });

  test('a relocated anchor rebinds the story hyperlink ids of both sides', async ({ given, when, then, and }: AllureBddContext) => {
    // Peer review of #1031: the side stories spliced into a re-tracked anchor
    // carry their own documents' relationship ids. The original numbers the
    // unchanged link rId5, the revised rId6; the output keeps only rId6.
    const anchored = (story: string, relationshipId: string): string =>
      `<w:p><w:r><w:t>All notices under this agreement shall be delivered in writing to the address shown in the box</w:t></w:r>` +
      `<w:r><w:pict><v:shape id="boxA" style="width:200pt;height:50pt"><v:textbox><w:txbxContent>` +
      `<w:p><w:hyperlink r:id="${relationshipId}"><w:r><w:t>${story}</w:t></w:r></w:hyperlink></w:p>` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const others = para('Second paragraph stays here with plenty of words.') + para('Third paragraph also stays put with words.');
    const link = (id: string) => [{ id, target: 'https://acme.example/' }];
    const original = await given('a linked box first, its link numbered rId5', () =>
      buildDocxFromBodyXml(anchored('Acme Corp', 'rId5') + others, link('rId5'), NAMESPACES));
    const revised = await given('the linked box last and edited, its link numbered rId6', () =>
      buildDocxFromBodyXml(others + anchored('Acme Corporation', 'rId6'), link('rId6'), NAMESPACES));

    const result = await when('the documents are compared', () => compareDocuments(original, revised));
    const archive = await DocxArchive.load(result.document);
    const output = await archive.getDocumentXml();
    const relationshipIds = new Set(
      Array.from(parseXml((await archive.getFile('word/_rels/document.xml.rels'))!)
        .getElementsByTagName('Relationship')).map((relationship) => relationship.getAttribute('Id')),
    );
    const linkIds = (xml: string): Array<string | null> =>
      Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'hyperlink')).map((hyperlink) =>
        hyperlink.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));

    await then('the anchor was re-tracked, so both side stories were spliced', () => {
      expect(textBoxes(output).map(anchorWrapper).sort()).toEqual(['del', 'ins']);
    });
    await and('every hyperlink in the output, accept-all and reject-all resolves', () => {
      for (const xml of [output, acceptAllChanges(output), rejectAllChanges(output)]) {
        const ids = linkIds(xml);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) expect(relationshipIds.has(id)).toBe(true);
      }
    });
  });

  test('an inserted or deleted box holding a nested text box is refused', async ({ given, when, then }: AllureBddContext) => {
    // Peer review of #1031: a whole-box lifecycle must not carry a story
    // shape the comparison refuses for a paired box (#1380).
    const nestedBox =
      `<w:p><w:r><w:pict><v:shape id="outer" style="width:200pt;height:50pt"><v:textbox><w:txbxContent>` +
      `<w:p><w:r><w:t>Outer</w:t></w:r><w:r><w:pict><v:shape id="inner"><v:textbox><w:txbxContent>` +
      `${para('Inner')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const plain = await given('a document without boxes', () => docx(para('Lead.')));
    const nested = await given('the same document with a box holding a nested box', () =>
      docx(para('Lead.') + nestedBox));

    const failures = await when('the box is inserted, then deleted', async () => {
      const outcomes: unknown[] = [];
      for (const [before, after] of [[plain, nested], [nested, plain]] as const) {
        try {
          await compareDocuments(before, after);
          outcomes.push(undefined);
        } catch (error) {
          outcomes.push(error);
        }
      }
      return outcomes;
    });

    await then('both directions are refused with the nested-box reason', () => {
      for (const failure of failures) {
        expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
        expect((failure as UnsupportedTextBoxRevisionError).changes[0]?.reason)
          .toContain('nested text boxes');
      }
    });
  });

  test('anonymous boxes that disagree about storage stay refused (#1383)', async ({ given, when, then }: AllureBddContext) => {
    const plain = (text: string): string =>
      `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${para(text)}` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const twin = (text: string): string =>
      `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic>` +
      `<a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${para(text)}</w:txbxContent></wps:txbx>` +
      `</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${para(text)}</w:txbxContent>` +
      `</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    const original = await given('two plain anonymous boxes', () => docx(plain('Charlie') + plain('Echo')));
    const revised = await given('one twinned anonymous box', () => docx(twin('Charlie')));

    let failure: unknown;
    await when('the documents are compared', async () => {
      try {
        await compareDocuments(original, revised);
      } catch (error) {
        failure = error;
      }
    });

    await then('the storage-shape refusal stands', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as UnsupportedTextBoxRevisionError).changes[0]?.reason)
        .toContain('storage shape differs');
    });
  });
});
