/**
 * VML text boxes host nested WordprocessingML paragraph stories.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/713
 * @see https://github.com/UseJunior/safe-docx/issues/726
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import {
  buildDocxFromBodyXml,
  COMPLETE_PAGE_FIELD,
} from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { groupElementsByTagNameNS } from '../markupCompatibility.js';
import {
  compareDocumentsAtomizer,
} from './pipeline.js';
import {
  UnsupportedTextBoxRevisionError,
} from './textBoxRevisionSafety.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'VML Text-Box Stories',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '19.1.2.22' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' },
  );

const TEXT_BOX_NAMESPACES = {
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;
const DRAWINGML_NAMESPACES = {
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
} as const;
const HEADER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

interface TextBoxFixtureOptions {
  paragraphId?: string;
  shapeId?: string;
  hyperlinkId?: string;
}

function paragraphWithTextBox(
  text: string,
  {
    paragraphId = '20000001',
    shapeId = 'shape1',
    hyperlinkId,
  }: TextBoxFixtureOptions = {},
): string {
  const storyText = hyperlinkId
    ? `<w:hyperlink r:id="${hyperlinkId}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink>`
    : `<w:r><w:t>${text}</w:t></w:r>`;
  return paragraphWithTextBoxStory(storyText, {
    paragraphId,
    shapeId,
  });
}

function paragraphWithTextBoxStory(
  storyXml: string,
  {
    paragraphId = '20000001',
    shapeId = 'shape1',
  }: TextBoxFixtureOptions = {},
): string {
  return (
    `<w:p><w:r><w:pict>` +
    `<v:shape id="${shapeId}" o:spid="_x0000_s1026">` +
    `<v:textbox><w:txbxContent>` +
    `<w:p w14:paraId="${paragraphId}" w14:textId="${paragraphId}">` +
    storyXml +
    `</w:p>` +
    `</w:txbxContent></v:textbox>` +
    `</v:shape></w:pict></w:r></w:p>`
  );
}

function paragraphWithTextBoxParagraphs(storyParagraphs: string): string {
  return (
    '<w:p><w:r><w:pict><v:shape id="bookmark-shape" o:spid="_x0000_s1099">' +
    '<v:textbox><w:txbxContent>' + storyParagraphs +
    '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>'
  );
}

/**
 * A DrawingML text box: `wps:txbx/w:txbxContent`, with no VML anywhere.
 *
 * `w:txbxContent` is in the `w:` namespace whichever host wraps it, so the
 * story walk finds this box exactly as it finds a VML one — but there is no
 * `v:shape` ancestor for `scaffoldFingerprint` to describe.
 * `spec-compliance/CONFORMANCE.md` (ECMA-PART4-14-9-1-1) puts this box
 * outside the covered subset. See issue #795.
 */
/** The `w:drawing` payload of a DrawingML text box, without its paragraph. */
function drawingMlBoxContent(text: string): string {
  return (
    `<w:drawing><wp:inline>` +
    `<wp:extent cx="2000000" cy="500000"/>` +
    `<wp:docPr id="1" name="Box 1"/>` +
    `<a:graphic><a:graphicData>` +
    `<wps:wsp><wps:txbx><w:txbxContent>` +
    `<w:p w14:paraId="30000001" w14:textId="30000001"><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

/** The `w:pict` payload of a VML text box, without its paragraph. */
function vmlBoxContent(text: string): string {
  return (
    `<w:pict><v:shape id="shape1" o:spid="_x0000_s1026">` +
    `<v:textbox><w:txbxContent>` +
    `<w:p w14:paraId="20000001" w14:textId="20000001"><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox>` +
    `</v:shape></w:pict>`
  );
}

function paragraphWithDrawingMlTextBox(
  text: string,
  { extentCx = '2000000', shapeName = 'Box 1' } = {},
): string {
  return (
    `<w:p><w:r><w:drawing><wp:inline>` +
    `<wp:extent cx="${extentCx}" cy="500000"/>` +
    `<wp:docPr id="1" name="${shapeName}"/>` +
    `<a:graphic><a:graphicData>` +
    `<wps:wsp><wps:txbx><w:txbxContent>` +
    `<w:p w14:paraId="30000001" w14:textId="30000001"><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

function drawingMlAncillaryStory(
  kind: 'header' | 'footer',
  text: string,
): string {
  const root = kind === 'header' ? 'hdr' : 'ftr';
  return (
    `<?xml version="1.0"?>` +
    `<w:${root} xmlns:w="${OOXML.W_NS}"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    Object.entries(DRAWINGML_NAMESPACES)
      .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
      .join('') +
    `>` +
    paragraphWithDrawingMlTextBox(text) +
    `</w:${root}>`
  );
}

function ancillaryStory(
  kind: 'header' | 'footer',
  text: string,
  shapeId = 'shape1',
  hyperlinkId?: string,
): string {
  const root = kind === 'header' ? 'hdr' : 'ftr';
  return (
    `<?xml version="1.0"?>` +
    `<w:${root} xmlns:w="${OOXML.W_NS}"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` xmlns:v="urn:schemas-microsoft-com:vml"` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office">` +
    paragraphWithTextBox(text, { shapeId, hyperlinkId }) +
    `</w:${root}>`
  );
}

interface SelectedStoryFixtureOptions {
  text: string;
  target?: string;
  shapeId?: string;
  bodyXml?: string;
  sectPrXml?: string;
  storyHyperlinkId?: string;
  storyHyperlinkTarget?: string;
}

async function selectedStoryFixture(
  kind: 'header' | 'footer',
  options: SelectedStoryFixtureOptions,
): Promise<Buffer> {
  const target = options.target ?? `${kind}1.xml`;
  const relationshipId = kind === 'header' ? 'rIdHeader' : 'rIdFooter';
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(
      options.bodyXml ?? paragraph('Body'),
      [],
      {
        namespaces: {
          r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        },
      },
    ),
  );
  archive.setDocumentXml(
    (await archive.getDocumentXml()).replace(
      '<w:sectPr/>',
      options.sectPrXml ??
        `<w:sectPr><w:${kind}Reference w:type="default" r:id="${relationshipId}"/></w:sectPr>`,
    ),
  );
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="${relationshipId}"` +
      ` Type="${kind === 'header' ? HEADER_RELATIONSHIP : FOOTER_RELATIONSHIP}"` +
      ` Target="${target}"/>` +
      `</Relationships>`,
  );
  archive.setFile(
    `word/${target}`,
    ancillaryStory(
      kind,
      options.text,
      options.shapeId,
      options.storyHyperlinkId,
    ),
  );
  if (options.storyHyperlinkId && options.storyHyperlinkTarget) {
    archive.setFile(
      `word/_rels/${target}.rels`,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="${options.storyHyperlinkId}"` +
        ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"` +
        ` Target="${options.storyHyperlinkTarget}" TargetMode="External"/>` +
        `</Relationships>`,
    );
  }
  return archive.save();
}

function selectedHeaderFixture(options: SelectedStoryFixtureOptions): Promise<Buffer> {
  return selectedStoryFixture('header', options);
}

function selectedFooterFixture(options: SelectedStoryFixtureOptions): Promise<Buffer> {
  return selectedStoryFixture('footer', options);
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function textBoxText(documentXml: string, index = 0): string {
  return (
    parseXml(documentXml)
      .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
      .item(index)?.textContent ?? ''
  );
}

function paragraphText(documentXml: string, index = 0): string {
  return (
    parseXml(documentXml)
      .getElementsByTagNameNS(OOXML.W_NS, 'p')
      .item(index)?.textContent ?? ''
  );
}

function hasTrackedRevisionAncestor(element: Element): boolean {
  let ancestor: Node | null = element.parentNode;
  while (ancestor?.nodeType === 1) {
    const candidate = ancestor as Element;
    if (
      candidate.namespaceURI === OOXML.W_NS &&
      (candidate.localName === 'ins' || candidate.localName === 'del')
    ) {
      return true;
    }
    ancestor = ancestor.parentNode;
  }
  return false;
}

describe('VML text-box story comparison (#713)', () => {
  test('reserves generated bookmark names across outer and text-box stories', async () => {
    const original = await buildDocxFromBodyXml(
      '<w:p><w:bookmarkStart w:id="1" w:name="OuterRange"/>' +
        '<w:r><w:t>outer doomed</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>outer survivor</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
        paragraphWithTextBoxParagraphs(
          '<w:p w14:paraId="21000001" w14:textId="21000001">' +
            '<w:bookmarkStart w:id="2" w:name="BoxRange"/>' +
            '<w:r><w:t>box doomed</w:t></w:r></w:p>' +
          '<w:p w14:paraId="21000002" w14:textId="21000002">' +
            '<w:r><w:t>box survivor</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>',
        ),
      [],
      { namespaces: TEXT_BOX_NAMESPACES },
    );
    const revised = await buildDocxFromBodyXml(
      '<w:p><w:bookmarkStart w:id="1" w:name="OuterRange"/>' +
        '<w:r><w:t>outer survivor</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
        paragraphWithTextBoxParagraphs(
          '<w:p w14:paraId="21000002" w14:textId="21000002">' +
            '<w:bookmarkStart w:id="2" w:name="BoxRange"/>' +
            '<w:r><w:t>box survivor</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>',
        ),
      [],
      { namespaces: TEXT_BOX_NAMESPACES },
    );

    const result = await compareDocumentsAtomizer(original, revised);
    const output = parseXml(await documentXml(result.document));
    const names = Array.from(output.getElementsByTagName('w:bookmarkStart'))
      .map((start) => start.getAttribute('w:name'))
      .filter((name): name is string => name !== null);
    const generatedNames = names.filter((name) => name.startsWith('_safe_docx_original_'));

    expect(new Set(names).size).toBe(names.length);
    expect(generatedNames).toHaveLength(2);
    expect(new Set(generatedNames).size).toBe(2);
  });

  test('emits a text-only revision inside w:txbxContent', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const original = await given('one VML text box with its original address', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('05 Main Street'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('the same shape with an edited nested story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('405 Main Street'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );

    const result = await when('the documents are compared in place', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('tracked revisions are nested inside the text-box story', () => {
      const output = parseXml(outputXml);
      const textBox = output
        .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
        .item(0);
      expect(textBox).not.toBeNull();
      expect(
        textBox!.getElementsByTagNameNS(OOXML.W_NS, 'ins').length,
      ).toBeGreaterThan(0);
      expect(
        textBox!.getElementsByTagNameNS(OOXML.W_NS, 'del').length,
      ).toBeGreaterThan(0);
      const shapes = output.getElementsByTagNameNS(
        'urn:schemas-microsoft-com:vml',
        'shape',
      );
      const pict = output.getElementsByTagNameNS(OOXML.W_NS, 'pict').item(0);
      expect(shapes.length).toBe(1);
      expect(pict).not.toBeNull();
      expect(hasTrackedRevisionAncestor(pict!)).toBe(false);
    });
    await and('accept and reject recover their source stories', () => {
      expect(textBoxText(acceptAllChanges(outputXml))).toBe('405 Main Street');
      expect(textBoxText(rejectAllChanges(outputXml))).toBe('05 Main Street');
    });
  });

  test('represents mixed body and text-box edits independently', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('an original body and nested story', () =>
      buildDocxFromBodyXml(
        paragraph('Original body') + paragraphWithTextBox('Original notice'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('authored edits in both stories', () =>
      buildDocxFromBodyXml(
        paragraph('Revised body') + paragraphWithTextBox('Revised notice'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );

    const result = await when('the documents are compared in place', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('both accept and reject recover the complete intended text', () => {
      const accepted = acceptAllChanges(outputXml);
      const rejected = rejectAllChanges(outputXml);
      expect(paragraphText(accepted)).toBe('Revised body');
      expect(textBoxText(accepted)).toBe('Revised notice');
      expect(paragraphText(rejected)).toBe('Original body');
      expect(textBoxText(rejected)).toBe('Original notice');
    });
  });

  test('keeps multiple changed stories in their original shape order', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('two original text-box stories', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Alpha', {
          paragraphId: '20000001',
          shapeId: 'shape1',
        }) +
          paragraphWithTextBox('Beta', {
            paragraphId: '20000002',
            shapeId: 'shape2',
          }),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('edits in both corresponding stories', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Alpha revised', {
          paragraphId: '20000001',
          shapeId: 'shape1',
        }) +
          paragraphWithTextBox('Beta revised', {
            paragraphId: '20000002',
            shapeId: 'shape2',
          }),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );

    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('each accepted and rejected story stays in its own shape', () => {
      const accepted = acceptAllChanges(outputXml);
      const rejected = rejectAllChanges(outputXml);
      expect([textBoxText(accepted, 0), textBoxText(accepted, 1)]).toEqual([
        'Alpha revised',
        'Beta revised',
      ]);
      expect([textBoxText(rejected, 0), textBoxText(rejected, 1)]).toEqual([
        'Alpha',
        'Beta',
      ]);
    });
  });

  test('supports a stable resolved hyperlink around changed story text', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const relationships = [{ id: 'rId5', target: 'https://example.test/' }];
    const original = await given('a linked original notice', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Original notice', { hyperlinkId: 'rId5' }),
        relationships,
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('the same link target with revised text', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Revised notice', { hyperlinkId: 'rId5' }),
        relationships,
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );

    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('the hyperlink survives and the nested story round-trips', () => {
      const output = parseXml(outputXml);
      const textBox = output
        .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
        .item(0)!;
      expect(
        textBox.getElementsByTagNameNS(OOXML.W_NS, 'hyperlink').length,
      ).toBe(1);
      expect(textBoxText(acceptAllChanges(outputXml))).toBe('Revised notice');
      expect(textBoxText(rejectAllChanges(outputXml))).toBe('Original notice');
    });
  });

  test('preserves direct formatting and an unchanged complex field', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const story = (text: string): string =>
      `<w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r>` +
      COMPLETE_PAGE_FIELD;
    const original = await given('a formatted story containing a PAGE field', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBoxStory(story('Original notice ')),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('an edit beside the unchanged field', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBoxStory(story('Revised notice ')),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );

    const result = await when('the formatted field-bearing story is compared', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('formatting, field topology, and projections survive', () => {
      const output = parseXml(outputXml);
      const textBox = output
        .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
        .item(0)!;
      expect(textBox.getElementsByTagNameNS(OOXML.W_NS, 'b').length)
        .toBeGreaterThan(0);
      expect(textBox.getElementsByTagNameNS(OOXML.W_NS, 'fldChar').length)
        .toBe(3);
      expect(textBoxText(acceptAllChanges(outputXml)))
        .toBe('Revised notice  PAGE 1');
      expect(textBoxText(rejectAllChanges(outputXml)))
        .toBe('Original notice  PAGE 1');
    });
  });

  test('fails closed when the VML shape scaffold changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('an original shape and story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Original', { shapeId: 'shape1' }),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('a changed shape identity and story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Revised', { shapeId: 'shape2' }),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    let failure: unknown;

    await when('comparison classifies the changed topology', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the typed diagnostic identifies scaffold mismatch', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            index: 0,
            partPath: 'word/document.xml',
            reason: expect.stringContaining('scaffold'),
          }),
        ],
      });
    });
  });

  test('fails closed when a DrawingML text box has no VML scaffold to pair', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // The scaffolds here are byte-identical on both sides. The refusal must
    // therefore come from the scaffold being *unpairable* (no v:shape to
    // fingerprint), not from the scaffold having changed — the distinction
    // `undefined !== undefined` could not draw. See issue #795.
    const originalBody = paragraphWithDrawingMlTextBox('Original');
    const revisedBody = paragraphWithDrawingMlTextBox('Revised');
    const scaffoldOf = (body: string): string =>
      body.slice(0, body.indexOf('<w:txbxContent'));

    const original = await given('a DrawingML-hosted original story', () =>
      buildDocxFromBodyXml(originalBody, [], {
        namespaces: DRAWINGML_NAMESPACES,
      }),
    );
    const revised = await given('the same DrawingML scaffold, edited story', () =>
      buildDocxFromBodyXml(revisedBody, [], {
        namespaces: DRAWINGML_NAMESPACES,
      }),
    );
    let failure: unknown;

    await when('comparison classifies the unpairable scaffold', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the box is refused, and not because the scaffold differed', () => {
      expect(scaffoldOf(revisedBody)).toBe(scaffoldOf(originalBody));
      expect(originalBody).not.toContain('<v:shape');
      expect(revisedBody).not.toContain('<v:shape');
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            index: 0,
            partPath: 'word/document.xml',
            reason: expect.stringContaining('scaffold'),
          }),
        ],
      });
    });
  });

  test('fails closed when an ancillary DrawingML text box has no VML scaffold to pair', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const withDrawingMlHeader = async (text: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(
        await selectedHeaderFixture({ text: 'placeholder' }),
      );
      archive.setFile('word/header1.xml', drawingMlAncillaryStory('header', text));
      return archive.save();
    };
    const original = await given('a DrawingML-hosted original header story', () =>
      withDrawingMlHeader('Original header'),
    );
    const revised = await given('the same header scaffold, edited story', () =>
      withDrawingMlHeader('Revised header'),
    );
    let failure: unknown;

    await when('comparison classifies the ancillary scaffold', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the ancillary box is refused with a scaffold diagnostic', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            index: 0,
            partPath: 'word/header1.xml',
            reason: expect.stringContaining('scaffold'),
          }),
        ],
      });
    });
  });

  test('control: non-v:shape VML hosts stay pairable', async ({
    when,
    then,
  }: AllureBddContext) => {
    // `v:textbox` belongs to `EG_ShapeElements`, so `v:rect`, `v:roundrect`
    // and `v:oval` host stories exactly as `v:shape` does. Failing closed on
    // an unpairable scaffold must not sweep these up: recognising the host by
    // the literal name `v:shape` reports "no scaffold" for all three and
    // refuses VML the engine handles fine.
    const hostedBox = (host: string, text: string): string =>
      `<w:p><w:r><w:pict>` +
      `<v:${host} id="host1" o:spid="_x0000_s1026">` +
      `<v:textbox><w:txbxContent>` +
      `<w:p w14:paraId="20000001" w14:textId="20000001"><w:r><w:t>${text}</w:t></w:r></w:p>` +
      `</w:txbxContent></v:textbox>` +
      `</v:${host}></w:pict></w:r></w:p>`;
    const redlined: string[] = [];

    await when('each VML host gets a story-only change', async () => {
      for (const host of ['rect', 'roundrect', 'oval']) {
        const result = await compareDocumentsAtomizer(
          await buildDocxFromBodyXml(hostedBox(host, 'Original'), [], {
            namespaces: TEXT_BOX_NAMESPACES,
          }),
          await buildDocxFromBodyXml(hostedBox(host, 'Revised'), [], {
            namespaces: TEXT_BOX_NAMESPACES,
          }),
          {},
        );
        const outputXml = await documentXml(result.document);
        if (
          textBoxText(acceptAllChanges(outputXml)) === 'Revised' &&
          textBoxText(rejectAllChanges(outputXml)) === 'Original'
        ) {
          redlined.push(host);
        }
      }
    });

    await then('every schema-declared host is redlined, not refused', () => {
      expect(redlined).toEqual(['rect', 'roundrect', 'oval']);
    });
  });

  test('control: an mc:AlternateContent twin box is not refused', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Word stores an ordinary text box twice — a DrawingML `mc:Choice` and a
    // VML `mc:Fallback`. The DrawingML copy has no VML host of its own, so a
    // scaffold guard that fails closed without noticing the twin would refuse
    // the commonest text box Word produces. Which copy of a twin governs is
    // the mc-aware story walk's question (#794); this pins that #795 does not
    // answer it by refusing the document.
    const twin = (text: string): string =>
      `<w:p><w:r><mc:AlternateContent>` +
      `<mc:Choice Requires="wps">${drawingMlBoxContent(text)}</mc:Choice>` +
      `<mc:Fallback>${vmlBoxContent(text)}</mc:Fallback>` +
      `</mc:AlternateContent></w:r></w:p>`;
    const namespaces = { ...TEXT_BOX_NAMESPACES, ...DRAWINGML_NAMESPACES };
    const original = await given('a twinned original box', () =>
      buildDocxFromBodyXml(twin('Original'), [], { namespaces }),
    );
    const revised = await given('the same twin with edited text', () =>
      buildDocxFromBodyXml(twin('Revised'), [], { namespaces }),
    );

    const result = await when('the twinned box is compared', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );

    await then('the comparison completes rather than failing closed', () => {
      expect(result.engine).toBe('tagged-tree');
    });
  });

  test('control: a pairable VML scaffold still admits the story change', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Negative control for the two tests above. Tightening the guard to reject
    // an unpairable scaffold must not make it reject everything: an identical,
    // *pairable* v:shape scaffold has to stay green, or the red tests above
    // would pass for the wrong reason.
    const original = await given('a VML-hosted original story', () =>
      buildDocxFromBodyXml(paragraphWithTextBox('Original'), [], {
        namespaces: TEXT_BOX_NAMESPACES,
      }),
    );
    const revised = await given('the same v:shape scaffold, edited story', () =>
      buildDocxFromBodyXml(paragraphWithTextBox('Revised'), [], {
        namespaces: TEXT_BOX_NAMESPACES,
      }),
    );

    const result = await when('the pairable story is compared in place', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('the story is redlined rather than refused', () => {
      expect(result.engine).toBe('tagged-tree');
      expect(textBoxText(acceptAllChanges(outputXml))).toBe('Revised');
      expect(textBoxText(rejectAllChanges(outputXml))).toBe('Original');
    });
  });

  test('fails closed when text-box topology is inserted or deleted', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('a document without a text box', () =>
      buildDocxFromBodyXml(paragraph('Body')),
    );
    const revised = await given('the same body with an inserted text box', () =>
      buildDocxFromBodyXml(
        paragraph('Body') + paragraphWithTextBox('Inserted'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    let failure: unknown;

    await when('comparison classifies the changed topology', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the typed diagnostic identifies unsupported topology', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            reason: expect.stringContaining('topology'),
          }),
        ],
      });
    });
  });

  test('fails closed for nested text boxes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const nestedStory = (text: string): string =>
      `<w:r><w:t>${text}</w:t></w:r>` +
      `<w:r><w:pict><v:shape id="nested" o:spid="_x0000_s1099">` +
      `<v:textbox><w:txbxContent><w:p><w:r><w:t>Nested</w:t></w:r></w:p>` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
    const original = await given('a nested original text box', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBoxStory(nestedStory('Original')),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('an edit in its outer story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBoxStory(nestedStory('Revised')),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    let failure: unknown;

    await when('comparison classifies the prohibited nesting', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the typed diagnostic identifies nested text boxes', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            reason: expect.stringContaining('nested text boxes'),
          }),
        ],
      });
    });
  });

  test('uses per-story tagged safety for a changed story', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('an original text-box story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Original'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('a revised text-box story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Revised'),
        [],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    let result!: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await when('comparison runs', async () => {
      result = await compareDocumentsAtomizer(original, revised);
    });

    await then('tagged publication round-trips independently', async () => {
      const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
      expect(parseXml(acceptAllChanges(xml)).documentElement.textContent).toContain('Revised');
      expect(parseXml(rejectAllChanges(xml)).documentElement.textContent).toContain('Original');
    });
  });

  test('fails closed when a story hyperlink target changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('an original linked story', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Original', { hyperlinkId: 'rId5' }),
        [{ id: 'rId5', target: 'https://example.test/original' }],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    const revised = await given('a revised story with a different target', () =>
      buildDocxFromBodyXml(
        paragraphWithTextBox('Revised', { hyperlinkId: 'rId5' }),
        [{ id: 'rId5', target: 'https://example.test/revised' }],
        { namespaces: TEXT_BOX_NAMESPACES },
      ),
    );
    let failure: unknown;

    await when('comparison resolves the relationship closure', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the typed diagnostic identifies the changed closure', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            reason: expect.stringContaining('relationship closure'),
          }),
        ],
      });
    });
  });

  test('ignores unselected header text boxes instead of pairing raw filenames', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const withHeaderStory = async (text: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(
        await buildDocxFromBodyXml(paragraph('Body')),
      );
      archive.setFile(
        'word/header1.xml',
        `<?xml version="1.0"?>` +
          `<w:hdr xmlns:w="${OOXML.W_NS}"` +
          ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
          ` xmlns:v="urn:schemas-microsoft-com:vml"` +
          ` xmlns:o="urn:schemas-microsoft-com:office:office">` +
          paragraphWithTextBox(text) +
          `</w:hdr>`,
      );
      return archive.save();
    };
    const original = await given('an original header text-box story', () =>
      withHeaderStory('Original header'),
    );
    const revised = await given('a revised header text-box story', () =>
      withHeaderStory('Revised header'),
    );
    const result = await when('comparison resolves only selected stories', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );

    await then('the unselected package allocation does not block comparison', () => {
      expect(result.stats.insertions).toBe(0);
      expect(result.stats.deletions).toBe(0);
    });
  });

  test('compares a same-path selected header text box', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('a selected original header story', () =>
      selectedHeaderFixture({ text: 'Original header' }),
    );
    const revised = await given('the same selected scaffold with edited text', () =>
      selectedHeaderFixture({ text: 'Revised header' }),
    );

    const result = await when('the selected story is compared in place', () =>
      compareDocumentsAtomizer(original, revised),
    );
    const archive = await DocxArchive.load(result.document);
    const output = await archive.getFile('word/header1.xml');

    await then('revisions live inside the selected header text box', () => {
      expect(output).not.toBeNull();
      const textBox = parseXml(output!)
        .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
        .item(0);
      expect(textBox?.getElementsByTagNameNS(OOXML.W_NS, 'ins').length).toBeGreaterThan(0);
      expect(textBox?.getElementsByTagNameNS(OOXML.W_NS, 'del').length).toBeGreaterThan(0);
      expect(textBoxText(acceptAllChanges(output!))).toBe('Revised header');
      expect(textBoxText(rejectAllChanges(output!))).toBe('Original header');
    });
  });

  test('pairs a selected header across physical-part renumbering', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('the semantic story at header1.xml', () =>
      selectedHeaderFixture({ text: 'Original header', target: 'header1.xml' }),
    );
    const revised = await given('the edited semantic story at header9.xml', () =>
      selectedHeaderFixture({ text: 'Revised header', target: 'header9.xml' }),
    );

    const result = await when('comparison pairs the binding-selected scaffolds', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const output = await (await DocxArchive.load(result.document))
      .getFile('word/header9.xml');

    await then('the revised selected part carries the nested redline', () => {
      expect(output).not.toBeNull();
      expect(textBoxText(acceptAllChanges(output!))).toBe('Revised header');
      expect(textBoxText(rejectAllChanges(output!))).toBe('Original header');
    });
  });

  test('preserves a selected story hyperlink across relationship-id renumbering', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('a linked original header story', () =>
      selectedHeaderFixture({
        text: 'Original linked header',
        storyHyperlinkId: 'rIdLink1',
        storyHyperlinkTarget: 'https://example.test/notice',
      }),
    );
    const revised = await given('the edited story with a reallocated relationship id', () =>
      selectedHeaderFixture({
        text: 'Revised linked header',
        storyHyperlinkId: 'rIdLink9',
        storyHyperlinkTarget: 'https://example.test/notice',
      }),
    );

    const result = await when('the owning relationship table follows the nested story', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );
    const archive = await DocxArchive.load(result.document);
    const [output, relationships] = await Promise.all([
      archive.getFile('word/header1.xml'),
      archive.getFile('word/_rels/header1.xml.rels'),
    ]);

    await then('the selected relationship closure remains resolvable after id normalization', () => {
      const outputRelationshipId = parseXml(output!)
        .getElementsByTagNameNS(OOXML.W_NS, 'hyperlink')[0]
        ?.getAttributeNS(OOXML.R_NS, 'id');
      const relationship = Array.from(
        parseXml(relationships!).getElementsByTagName('Relationship'),
      ).find((candidate) => candidate.getAttribute('Id') === outputRelationshipId);
      expect(outputRelationshipId).toBeTruthy();
      expect(relationship?.getAttribute('Target')).toBe('https://example.test/notice');
      expect(relationship?.getAttribute('TargetMode')).toBe('External');
      expect(textBoxText(acceptAllChanges(output!))).toBe('Revised linked header');
      expect(textBoxText(rejectAllChanges(output!))).toBe('Original linked header');
    });
  });

  test('allows a side-only footer story owned by an inserted section', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('one section without a selected header', () =>
      buildDocxFromBodyXml(paragraph('Body')),
    );
    const insertedSection =
      `<w:p><w:pPr><w:sectPr>` +
      `<w:footerReference w:type="default" r:id="rIdFooter"/>` +
      `</w:sectPr></w:pPr><w:r><w:t>Inserted section</w:t></w:r></w:p>`;
    const revised = await given('an inserted section selecting a new footer story', () =>
      selectedFooterFixture({
        text: 'New section footer',
        target: 'footer9.xml',
        bodyXml: paragraph('Body') + insertedSection,
        sectPrXml: '<w:sectPr/>',
      }),
    );

    const result = await when('the relationship-aware lifecycle check runs', () =>
      compareDocumentsAtomizer(original, revised, {
      }),
    );

    await then('the inserted section lifecycle is publishable', () => {
      expect(result.engine).toBe('tagged-tree');
      expect(result.stats.insertions).toBeGreaterThan(0);
    });
  });

  test('fails closed when a side-only story replaces a corresponding section', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('one selected header scaffold', () =>
      selectedHeaderFixture({
        text: 'Original header',
        target: 'header1.xml',
        shapeId: 'shape1',
      }),
    );
    const revised = await given('a non-pairable replacement in the same section', () =>
      selectedHeaderFixture({
        text: 'Revised header',
        target: 'header9.xml',
        shapeId: 'shape9',
      }),
    );
    let failure: unknown;

    await when('relationship-aware classification refuses to guess', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('a typed non-content-bearing diagnostic identifies the selected part', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as UnsupportedTextBoxRevisionError).changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: expect.stringContaining('exclusively'),
          }),
        ]),
      );
    });
  });
});

/**
 * The guards above are established on hand-built XML, which exercises the
 * fixture builder as much as the code. These run the same guards against a
 * before/after pair authored in Microsoft Word — the first document in the
 * corpus to contain a text box at all.
 *
 * **What is Word-authored and what is Word-derived.** Two cases run the
 * untouched files: the counting case and the twin admission case, which is
 * what Word actually produces. The standalone-DrawingML and non-`v:shape`
 * cases run markup *derived* from those files by keeping one
 * `mc:AlternateContent` branch and discarding the twin. That is stronger than
 * hand-writing the XML — every byte inside the surviving branch is Word's —
 * but it is not a claim that some producer emits a bare `wps:txbx` with no
 * `mc:AlternateContent` wrapper. No such fixture is in the corpus, and the
 * standalone case should be read as Word-derived, not Word-authored.
 *
 * @see tests/test_documents/text-box/README.md
 * @see https://github.com/UseJunior/safe-docx/issues/795
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */
describe('Word-authored text-box corpus (#795)', () => {
  const CORPUS = join(
    import.meta.dirname,
    '../../../..',
    'tests/test_documents/text-box',
  );
  const SOURCE = join(CORPUS, 'source.docx');
  const REVISED = join(CORPUS, 'revised.docx');
  const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

  async function rewriteDocumentXml(
    path: string,
    rewrite: (xml: string) => string,
  ): Promise<Buffer> {
    const zip = await JSZip.loadAsync(readFileSync(path));
    zip.file('word/document.xml', rewrite(await documentXml(readFileSync(path))));
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  /**
   * Keep one branch of every `mc:AlternateContent` and discard the twin.
   *
   * Both branches are markup Word itself wrote, so this derives the
   * standalone-DrawingML and plain-VML shapes without hand-authoring any of
   * their content: what varies is which of Word's two spellings survives.
   */
  function keepBranch(
    branch: 'Choice' | 'Fallback',
    only?: number,
  ): (xml: string) => string {
    return (xml) => {
      let seen = -1;
      return xml.replace(
        /<mc:AlternateContent\b[^>]*>([\s\S]*?)<\/mc:AlternateContent>/g,
        (whole: string, inner: string): string => {
          seen += 1;
          if (only !== undefined && seen !== only) return whole;
          const kept = new RegExp(
            `<mc:${branch}\\b[^>]*>([\\s\\S]*?)</mc:${branch}>`,
          ).exec(inner);
          return kept?.[1] ?? whole;
        },
      );
    };
  }

  /** Every stored `w:txbxContent`'s text, in document order — twins included. */
  function storedStoryTexts(xml: string): string[] {
    return [
      ...xml.matchAll(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g),
    ].map(([story]) =>
      [...story.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map(([, text]) => text ?? '')
        .join(''),
    );
  }

  /** The DrawingML scaffold of each box, with its story blanked out. */
  function drawingMlScaffolds(xml: string): string[] {
    return [
      ...xml.matchAll(/<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/g),
    ].map(([, inner]) =>
      (inner ?? '').replace(
        /<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g,
        '<story/>',
      ),
    );
  }

  function textOf(element: Element): string {
    return Array.from(element.getElementsByTagNameNS(OOXML.W_NS, 't'))
      .map((node) => node.textContent ?? '')
      .join('');
  }

  test('stores two authored boxes as four w:txbxContent, and counts them as two', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Word writes each box twice inside one `mc:AlternateContent` — a
    // DrawingML `mc:Choice` and a VML `mc:Fallback` — and renders one. This
    // pins the storage shape the counting guards have to cope with, on a file
    // Word produced rather than one this suite built. See issue #794.
    let counts: Array<{
      label: string;
      stored: number;
      visual: number;
      alternateContent: number;
      texts: string[];
    }> = [];

    const documents = await given('the Word-authored before/after pair', () => ({
      source: readFileSync(SOURCE),
      revised: readFileSync(REVISED),
    }));

    await when('each side is counted by storage and by rendered branch', async () => {
      counts = await Promise.all(
        (['source', 'revised'] as const).map(async (label) => {
          const xml = await documentXml(documents[label]);
          const document = parseXml(xml);
          const groups = groupElementsByTagNameNS(
            document,
            OOXML.W_NS,
            'txbxContent',
          );
          return {
            label,
            stored: document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
              .length,
            visual: groups.length,
            alternateContent: document.getElementsByTagNameNS(
              MC_NS,
              'AlternateContent',
            ).length,
            texts: groups.map((group) => textOf(group.selected)),
          };
        }),
      );
    });

    await then('two authored boxes present as four stored copies', () => {
      for (const side of counts) {
        expect(side).toMatchObject({
          stored: 4,
          visual: 2,
          alternateContent: 2,
        });
      }
      expect(counts.map(({ texts }) => texts)).toEqual([
        ['Text box 1', 'Text box 2'],
        ['1st Text box is first. . .', 'This is text box number two.'],
      ]);
    });
  });

  test('admits the mc:AlternateContent twin, and round-trips both branches', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Failing closed on a missing VML host without noticing the twin would
    // refuse the commonest text box Word makes. Admitting it is only safe if
    // the redline is reversible, so assert the round trip rather than the mere
    // presence of revisions: accept-all must reproduce the revised text and
    // reject-all the original, in *both* stored branches, with the DrawingML
    // scaffold Word wrote left alone. See issue #795.
    let redlined = '';
    let accepted = '';
    let rejected = '';
    let sourceXml = '';
    let revisedXml = '';

    const documents = await given('the Word-authored pair, both boxes edited', () => ({
      source: readFileSync(SOURCE),
      revised: readFileSync(REVISED),
    }));

    await when('the pair is compared, then accepted and rejected', async () => {
      const result = await compareDocumentsAtomizer(
        documents.source,
        documents.revised,
        {},
      );
      redlined = await documentXml(result.document);
      accepted = acceptAllChanges(redlined);
      rejected = rejectAllChanges(redlined);
      sourceXml = await documentXml(documents.source);
      revisedXml = await documentXml(documents.revised);
    });

    await then('the redline is real and exactly reversible', () => {
      // The refusal path throws, so reaching here is itself the admission.
      expect(storedStoryTexts(redlined)).toHaveLength(4);
      expect(redlined).toMatch(/<w:ins\b/);
      expect(redlined).toMatch(/<w:del\b/);

      // Reversibility, per stored copy — this covers the unrendered
      // `mc:Fallback` twin as well as the `mc:Choice` Word renders.
      expect(rejected && storedStoryTexts(rejected)).toEqual(
        storedStoryTexts(sourceXml),
      );
      expect(accepted && storedStoryTexts(accepted)).toEqual(
        storedStoryTexts(revisedXml),
      );

      // Both branches of each visual box still say the same thing. A redline
      // that updated only the rendered copy would leave the document saying
      // two different things depending on which Word opened it.
      for (const side of [accepted, rejected]) {
        const [choice1, fallback1, choice2, fallback2] = storedStoryTexts(side);
        expect(choice1).toBe(fallback1);
        expect(choice2).toBe(fallback2);
      }

      // The scaffold is not the story's to change.
      expect(drawingMlScaffolds(rejected)).toEqual(drawingMlScaffolds(sourceXml));
      expect(drawingMlScaffolds(accepted)).toEqual(drawingMlScaffolds(revisedXml));
    });
  });

  test('control: the admission path leaves the unchanged body paragraph alone', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // An integration control over the admission path, not an isolated
    // measurement of guard scope: it necessarily reds whenever the guard stops
    // admitting the twin, because then there is no redline to inspect. That
    // coupling is the point — it catches a guard that has gone over-broad and
    // refuses documents wholesale, and separately catches a comparison that
    // has gone over-eager and marks up text nobody touched.
    let outsideTextBoxes: string | undefined;

    const documents = await given('a pair whose only edits are inside the boxes', () => ({
      source: readFileSync(SOURCE),
      revised: readFileSync(REVISED),
    }));

    await when('the redline is stripped of every text-box story', async () => {
      const result = await compareDocumentsAtomizer(
        documents.source,
        documents.revised,
        {},
      );
      outsideTextBoxes = (await documentXml(result.document)).replace(
        /<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g,
        '',
      );
    });

    await then('the body paragraph survives unrevised', () => {
      expect(outsideTextBoxes).toContain('Body text');
      expect(outsideTextBoxes).not.toMatch(/<w:ins\b/);
      expect(outsideTextBoxes).not.toMatch(/<w:del\b/);
    });
  });

  test('numbers a refusal by the box a reader sees, not the copy Word stored', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // #803 separated the storage address from the ordinal a reader can act on.
    // Strip the twin from the *second* authored box only, leaving the first as
    // Word wrote it. The refusal must name box `[1]` — the second visual box —
    // where a walk counting stored copies would say `[2]`, the second copy of
    // the *first* box, and send a reader somewhere that does not exist.
    let failure: unknown;
    let sourceXml = '';

    const derived = await given('the twin removed from the second box only', async () => {
      const secondOnly = keepBranch('Choice', 1);
      const source = await rewriteDocumentXml(SOURCE, secondOnly);
      const revised = await rewriteDocumentXml(REVISED, secondOnly);
      sourceXml = await documentXml(source);
      return { source, revised };
    });

    await when('comparison refuses the now-standalone second box', async () => {
      try {
        await compareDocumentsAtomizer(derived.source, derived.revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the diagnostic names the second visual box', () => {
      // Box 1 keeps its twin (2 stored copies); box 2 is now standalone (1).
      expect(sourceXml.match(/<mc:AlternateContent\b/g)).toHaveLength(1);
      expect(storedStoryTexts(sourceXml)).toEqual([
        'Text box 1',
        'Text box 1',
        'Text box 2',
      ]);

      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as UnsupportedTextBoxRevisionError).changes).toEqual([
        expect.objectContaining({
          index: 1,
          partPath: 'word/document.xml',
          reason: 'the containing VML shape scaffold changed or could not be paired',
        }),
      ]);
      expect((failure as Error).message).toContain('#w:txbxContent[1]');
    });
  });

  test('refuses a standalone DrawingML box derived from the same document', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // The case `spec-compliance/CONFORMANCE.md` (ECMA-PART4-14-9-1-1)
    // excludes. Keeping only Word's `mc:Choice` leaves a DrawingML box with no
    // VML twin to borrow a scaffold from.
    //
    // The DrawingML scaffolds are byte-identical on both sides, so the refusal
    // is provably caused by the scaffold being *unpairable*, not by its having
    // changed — the distinction `undefined !== undefined` could not draw.
    let failure: unknown;
    let sourceXml = '';
    let revisedXml = '';
    let authoredScaffolds: [string[], string[]] = [[], []];

    const derived = await given('only the DrawingML branch Word wrote', async () => {
      const source = await rewriteDocumentXml(SOURCE, keepBranch('Choice'));
      const revised = await rewriteDocumentXml(REVISED, keepBranch('Choice'));
      sourceXml = await documentXml(source);
      revisedXml = await documentXml(revised);
      authoredScaffolds = [
        drawingMlScaffolds(await documentXml(readFileSync(SOURCE))),
        drawingMlScaffolds(await documentXml(readFileSync(REVISED))),
      ];
      return { source, revised };
    });

    await when('comparison classifies the unpairable scaffold', async () => {
      try {
        await compareDocumentsAtomizer(derived.source, derived.revised, {
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the box is refused, and not because the scaffold differed', () => {
      // The derivation produced what it claims to: DrawingML, no VML, no twin.
      for (const xml of [sourceXml, revisedXml]) {
        expect(xml).not.toContain('<v:shape');
        expect(xml).not.toContain('<mc:AlternateContent');
        expect(xml).toContain('<wps:txbx');
        expect(
          parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length,
        ).toBe(2);
      }
      // Both boxes' DrawingML scaffolds are byte-identical across the pair, so
      // "the scaffold changed" cannot be what refused them.
      expect(authoredScaffolds[1]).toEqual(authoredScaffolds[0]);
      expect(authoredScaffolds[0]).toHaveLength(2);

      // Pin the exact classification, not merely that something mentioning
      // "scaffold" threw: the relationship-closure and unsupported-story
      // guards sit next to this one and would refuse for different reasons.
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as UnsupportedTextBoxRevisionError).changes).toEqual([
        expect.objectContaining({
          index: 0,
          partPath: 'word/document.xml',
          reason: 'the containing VML shape scaffold changed or could not be paired',
        }),
      ]);
    });
  });

  test('control: admits schema-valid non-v:shape VML hosts', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // `v:textbox` belongs to `EG_ShapeElements`, which `CT_Shape` shares with
    // `CT_Rect`, `CT_RoundRect` and `CT_Oval`. Matching the host by the
    // literal name `v:shape` would report "no scaffold" for these and — now
    // that callers fail closed on that — refuse VML the engine handles.
    // Derived from the `mc:Fallback` branch Word wrote, so only the host
    // element name varies. See issue #795.
    const hosts = ['shape', 'rect', 'roundrect', 'oval'] as const;
    let admitted: string[] = [];

    await given('Word\'s VML branch, rehosted on each shape type', () => {});

    await when('each host is compared in place', async () => {
      admitted = [];
      for (const host of hosts) {
        const rehost = (xml: string): string =>
          keepBranch('Fallback')(xml)
            .replace(/<v:shape\b/g, `<v:${host}`)
            .replace(/<\/v:shape>/g, `</v:${host}>`);
        const source = await rewriteDocumentXml(SOURCE, rehost);
        const revised = await rewriteDocumentXml(REVISED, rehost);
        const sourceXml = await documentXml(source);
        expect(
          sourceXml.match(new RegExp(`<v:${host}\\b`, 'g')),
        ).toHaveLength(2);
        expect(sourceXml).not.toContain('<mc:AlternateContent');

        const result = await compareDocumentsAtomizer(source, revised, {
        });
        if (result.engine === 'tagged-tree') admitted.push(host);
      }
    });

    await then('every schema-valid host is redlined in place', () => {
      expect(admitted).toEqual([...hosts]);
    });
  });
});
