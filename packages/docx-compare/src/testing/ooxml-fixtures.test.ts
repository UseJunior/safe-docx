import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
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
});
