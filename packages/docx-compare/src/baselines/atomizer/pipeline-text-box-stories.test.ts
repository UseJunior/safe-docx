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

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import {
  buildDocxFromBodyXml,
  COMPLETE_PAGE_FIELD,
} from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
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
        reconstructionMode: 'inplace',
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
        reconstructionMode: 'inplace',
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
        reconstructionMode: 'inplace',
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
        reconstructionMode: 'inplace',
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
        reconstructionMode: 'inplace',
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
          reconstructionMode: 'inplace',
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
          reconstructionMode: 'inplace',
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
          reconstructionMode: 'inplace',
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

  test('fails closed when a changed story is explicitly rebuilt', async ({
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
    let failure: unknown;

    await when('rebuild comparison is explicitly requested', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
          reconstructionMode: 'rebuild',
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the typed diagnostic states the in-place boundary', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            reason: expect.stringContaining('reconstructionMode=inplace'),
          }),
        ],
      });
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
          reconstructionMode: 'inplace',
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
        reconstructionMode: 'inplace',
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
      compareDocumentsAtomizer(original, revised, {
        reconstructionMode: 'inplace',
        leanXmlVerifier: {
          enabled: true,
          executablePath: '/does/not/exist',
        },
      }),
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
      expect(result.documentIntegrity?.exclusions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Relationship-selected header/footer'),
        ]),
      );
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
        reconstructionMode: 'inplace',
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
        reconstructionMode: 'inplace',
      }),
    );
    const archive = await DocxArchive.load(result.document);
    const [output, relationships] = await Promise.all([
      archive.getFile('word/header1.xml'),
      archive.getFile('word/_rels/header1.xml.rels'),
    ]);

    await then('the revised relationship closure remains selected and resolvable', () => {
      expect(output).toContain('r:id="rIdLink9"');
      expect(output).not.toContain('r:id="rIdLink1"');
      expect(relationships).toContain('Id="rIdLink9"');
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
        reconstructionMode: 'inplace',
      }),
    );

    await then('the inserted section lifecycle is publishable', () => {
      expect(result.reconstructionModeUsed).toBe('inplace');
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
          reconstructionMode: 'inplace',
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
