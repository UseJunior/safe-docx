/**
 * Cross-document text-box pairing by anchor identity, with a positional
 * fallback only for boxes that carry no usable identity.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1031
 */

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { groupElementsByTagNameNS } from '../markupCompatibility.js';
import {
  pairTextBoxCandidates,
  textBoxPairingCandidates,
  type TextBoxPairingCandidate,
} from './textBoxIdentityPairing.js';

const TEST_FEATURE = 'Text-Box Identity Pairing';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

const box = (identity: string | undefined, content: string, storage = '1:plain:balanced'): TextBoxPairingCandidate => ({
  copies: [],
  identity,
  content,
  storage,
});

describe('text-box identity pairing', () => {
  test('identified boxes pair by identity, never by position', async ({ when, then }: AllureBddContext) => {
    const pairing = await when('a new box is inserted ahead of two identified boxes', () =>
      pairTextBoxCandidates(
        [box('vml:a', 'A'), box('vml:b', 'B')],
        [box('vml:n', 'N'), box('vml:a', 'A2'), box('vml:b', 'B')],
      ));
    await then('each original box pairs with its own identity', () => {
      expect(pairing.pairs).toEqual([[0, 1], [1, 2]]);
    });
  });

  test('a swap pairs one box with itself and leaves the other unpaired', async ({ when, then }: AllureBddContext) => {
    const pairing = await when('two identified boxes swap order', () =>
      pairTextBoxCandidates(
        [box('vml:a', 'A'), box('vml:b', 'B')],
        [box('vml:b', 'B'), box('vml:a', 'A')],
      ));
    await then('no box pairs with a different identity', () => {
      expect(pairing.pairs).toHaveLength(1);
      for (const [original, revised] of pairing.pairs) {
        expect(['vml:a', 'vml:b'][original]).toBe(['vml:b', 'vml:a'][revised]);
      }
    });
  });

  test('duplicated identities fall back to anchor position', async ({ when, then }: AllureBddContext) => {
    const pairing = await when('both documents reuse one shape id for every box', () =>
      pairTextBoxCandidates(
        [box('vml:shape1', 'A'), box('vml:shape1', 'B')],
        [box('vml:shape1', 'A2'), box('vml:shape1', 'B2')],
      ));
    await then('equal counts pair in order, as before identities were read', () => {
      expect(pairing.pairs).toEqual([[0, 0], [1, 1]]);
    });
  });

  test('anonymous boxes pair on identical content, and unequal gaps stay unpaired', async ({ when, then }: AllureBddContext) => {
    const pairing = await when('an anonymous box is inserted before an unchanged one', () =>
      pairTextBoxCandidates(
        [box(undefined, 'Same')],
        [box(undefined, 'New'), box(undefined, 'Same')],
      ));
    await then('the unchanged box pairs with itself and the new box is unpaired', () => {
      expect(pairing.pairs).toEqual([[0, 1]]);
      expect(pairing.ambiguousStorage).toBeUndefined();
    });
  });

  test('anonymous boxes that disagree about storage in one gap are ambiguous', async ({ when, then }: AllureBddContext) => {
    const pairing = await when('two plain boxes face one twinned box', () =>
      pairTextBoxCandidates(
        [box(undefined, 'C'), box(undefined, 'E')],
        [box(undefined, 'C2', '2:twinned:balanced')],
      ));
    await then('the gap is reported rather than guessed at', () => {
      expect(pairing.ambiguousStorage).toEqual({ original: 0, revised: 0 });
    });
  });

  test('the two stored copies of a twinned box form one identity', async ({ given, when, then }: AllureBddContext) => {
    const document = await given('a Word box stored as DrawingML and VML', async () => {
      const docx = await buildDocxFromBodyXml(
        `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline>` +
          `<wp:docPr id="4" name="Text Box 4"/><a:graphic><a:graphicData><wps:wsp><wps:txbx>` +
          `<w:txbxContent><w:p/></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>` +
          `</wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="Text Box 4">` +
          `<v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict>` +
          `</mc:Fallback></mc:AlternateContent></w:r></w:p>`,
        [],
        {
          namespaces: {
            v: 'urn:schemas-microsoft-com:vml',
            wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
            a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
            wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
          },
          ignorablePrefixes: ['wps'],
        },
      );
      return parseXml(await (await DocxArchive.load(docx)).getDocumentXml());
    });
    const candidates = await when('the boxes are described for pairing', () => {
      const copies = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
      return textBoxPairingCandidates(
        groupElementsByTagNameNS(document, OOXML.W_NS, 'txbxContent'),
        new Map(copies.map((copy, index) => [copy, index])),
      );
    });
    await then('one candidate carries both identifiers and both copies', () => {
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.identity).toBe('dml:4|vml:Text Box 4');
      expect(candidates[0]!.copies).toHaveLength(2);
      expect(candidates[0]!.storage).toBe('2:twinned:balanced');
    });
  });
});
