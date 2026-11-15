import { DOMParser } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { OOXML } from '../primitives/namespaces.js';
import { parseXml } from '../primitives/xml.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { testAllure, type AllureBddContext } from './allure-test.js';
import {
  buildDocxFromBodyXml,
  decoratedComplexField,
  FIELD_INSTRUCTIONS,
} from './ooxml-fixtures.js';

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'OOXML Fixtures',
  severity: 'critical',
});

describe('OOXML fixture attribute safety', () => {
  test(
    'decoratedComplexField keeps a quote-bearing bookmark anchor in one attribute',
    async ({ when, then }: AllureBddContext) => {
      const anchor = 'safe" w:tooltip="injected & < >';
      let hyperlink: Element | undefined;

      await when('the decorated field is parsed as OOXML', () => {
        const xml =
          `<w:p xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}">` +
          decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '7', anchor) +
          `</w:p>`;
        const doc = parseXml(xml);
        const found = doc.getElementsByTagNameNS(OOXML.W_NS, 'hyperlink')[0];
        if (!found) throw new Error('missing hyperlink');
        hyperlink = found;
      });

      await then('the original anchor round-trips without injecting another attribute', () => {
        if (!hyperlink) throw new Error('missing hyperlink');
        expect(hyperlink.getAttributeNS(OOXML.W_NS, 'anchor')).toBe(anchor);
        expect(hyperlink.hasAttributeNS(OOXML.W_NS, 'tooltip')).toBe(false);
      });
    },
  );

  test(
    'buildDocxFromBodyXml keeps a quote-bearing namespace URI in one attribute',
    async ({ when, then }: AllureBddContext) => {
      const namespaceUri = 'urn:fixture" injected="yes & more';
      let documentRoot: Element | undefined;

      await when('the fixture package is built with the namespace', async () => {
        const buffer = await buildDocxFromBodyXml('<w:p/>', [], {
          namespaces: { ext: namespaceUri },
          ignorablePrefixes: ['ext'],
        });
        const archive = await DocxArchive.load(buffer);
        documentRoot = parseXml(await archive.getDocumentXml()).documentElement;
      });

      await then('the namespace and ignorable list round-trip without attribute injection', () => {
        if (!documentRoot) throw new Error('missing document root');
        expect(documentRoot.getAttribute('xmlns:ext')).toBe(namespaceUri);
        expect(documentRoot.getAttributeNS(MC_NS, 'Ignorable')).toBe('w14 ext');
        expect(documentRoot.hasAttribute('injected')).toBe(false);
      });
    },
  );

  test(
    'buildDocxFromBodyXml rejects unsafe namespace prefix tokens',
    async ({ then }: AllureBddContext) => {
      await then('attribute-name and ignorable-list injection attempts fail closed', async () => {
        await expect(
          buildDocxFromBodyXml('<w:p/>', [], {
            namespaces: { 'ext" injected': 'urn:fixture' },
          }),
        ).rejects.toThrow('Invalid XML namespace prefix');
        await expect(
          buildDocxFromBodyXml('<w:p/>', [], {
            ignorablePrefixes: ['ext injected'],
          }),
        ).rejects.toThrow('Invalid XML namespace prefix');
      });
    },
  );

  test(
    'buildDocxFromBodyXml declares a restated built-in namespace and Ignorable prefix once',
    async ({ when, then }: AllureBddContext) => {
      let documentXml = '';

      await when('a caller restates w14 and mc and lists w14 as ignorable again', async () => {
        const buffer = await buildDocxFromBodyXml('<w:p/>', [], {
          namespaces: { w14: OOXML.W14_NS, mc: MC_NS, ext: 'urn:fixture:ext' },
          ignorablePrefixes: ['w14', 'ext', 'ext'],
        });
        documentXml = await (await DocxArchive.load(buffer)).getDocumentXml();
      });

      await then('the root is well-formed, binds each prefix once and lists each ignorable prefix once', () => {
        // xmldom's default handler throws on a repeated attribute, unlike
        // parseXml, which repairs a repeated namespace declaration (#1032).
        const root = new DOMParser().parseFromString(documentXml, 'application/xml').documentElement!;
        const declarations = Array.from(root.attributes)
          .map((attribute) => attribute.name)
          .filter((name) => name.startsWith('xmlns:'));
        expect(declarations).toEqual(['xmlns:w', 'xmlns:w14', 'xmlns:mc', 'xmlns:ext']);
        expect(root.getAttributeNS(MC_NS, 'Ignorable')).toBe('w14 ext');
      });
    },
  );

  test(
    'buildDocxFromBodyXml rejects a conflicting built-in prefix and an unusable Ignorable prefix',
    async ({ then }: AllureBddContext) => {
      await then('each would make the fixture root malformed, so each fails closed', async () => {
        await expect(
          buildDocxFromBodyXml('<w:p/>', [], { namespaces: { w14: 'urn:fixture:other' } }),
        ).rejects.toThrow('Namespace prefix "w14" is already bound');
        await expect(
          buildDocxFromBodyXml('<w:p/>', [], { ignorablePrefixes: ['wps'] }),
        ).rejects.toThrow('Ignorable prefix "wps" is not bound on the fixture root');
        await expect(
          buildDocxFromBodyXml('<w:p/>', [], { ignorablePrefixes: ['mc'] }),
        ).rejects.toThrow('Ignorable prefix "mc" names the Markup Compatibility namespace');
      });
    },
  );
});
