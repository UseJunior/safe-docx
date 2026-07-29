/**
 * VML text boxes host nested WordprocessingML paragraph stories.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/713
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
  );

const TEXT_BOX_NAMESPACES = {
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;

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

  test('reports changed header text boxes as an explicit scope boundary', async ({
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
    let failure: unknown;

    await when('comparison discovers ancillary text-box stories', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, {
          reconstructionMode: 'inplace',
        });
      } catch (error) {
        failure = error;
      }
    });

    await then('the typed diagnostic reports the exact unsupported part', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect(failure).toMatchObject({
        changes: [
          expect.objectContaining({
            partPath: 'word/header1.xml',
            reason: expect.stringContaining('ancillary'),
          }),
        ],
      });
    });
  });
});
