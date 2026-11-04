import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { computeNumberingIdentities } from './numberingIntegration.js';
import { constructTaggedTree } from './taggedTreeConstruction.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Comparison Numbering Identity' });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const EVIDENCE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../scripts/oracle/word/evidence');

interface OracleEvidence {
  numberingXml: string;
  stylesXml: string;
  fixtures: Record<string, { bodyXml: string; paragraphs: Array<{ text: string; word: string }> }>;
}

/** Word for Mac 16.114 measurements recorded for #1243 (shared w:num) and #1244 (style numbering). */
function evidence(issue: 1243 | 1244): OracleEvidence {
  return JSON.parse(readFileSync(resolve(EVIDENCE_DIR, `issue-${issue}-word-16.114.json`), 'utf8')) as OracleEvidence;
}

function documentBody(bodyXml: string): Element {
  return parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`)
    .getElementsByTagNameNS(W_NS, 'body')[0]!;
}

/** The identity of every body paragraph, in order, '' for an unnumbered one. */
function identitiesInOrder(body: Element, numberingXml: string, stylesXml?: string): string[] {
  const identities = computeNumberingIdentities(body, { numberingXml, stylesXml });
  return Array.from(body.getElementsByTagNameNS(W_NS, 'p')).map((p) => identities.get(p) ?? '');
}

/** The label part of a `numId:ilvl:label` identity. */
function label(identity: string): string {
  return identity.split(':').slice(2).join(':');
}

describe('comparison numbering identities follow Word list numbering', () => {
  test('continues one sequence across w:num instances of one abstract definition', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.15' });
    const oracle = evidence(1243);
    const fixture = oracle.fixtures['a_shared_no_override']!;
    let identities: string[] = [];
    await given('Word\'s a_shared_no_override fixture: w:num 1 and 2 over abstractNum 0, interleaved', () => {});
    await when('compare computes numbering identities', () => {
      identities = identitiesInOrder(documentBody(fixture.bodyXml), oracle.numberingXml);
    });
    await then('the labels continue 1. through 5. as Word shows them, keeping each paragraph\'s numId', () => {
      expect(identities.map(label)).toEqual(fixture.paragraphs.map((p) => p.word));
      expect(identities).toEqual(['1:0:1.', '1:0:2.', '2:0:3.', '1:0:4.', '2:0:5.']);
    });
  });

  test('labels paragraphs numbered through their paragraph style', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.23' });
    const oracle = evidence(1244);
    const fixture = oracle.fixtures['s_a_heading_styles']!;
    let identities: string[] = [];
    await given('Word\'s s_a_heading_styles fixture: headings with no direct w:numPr', () => {});
    await when('compare computes numbering identities with the styles part', () => {
      identities = identitiesInOrder(documentBody(fixture.bodyXml), oracle.numberingXml, oracle.stylesXml);
    });
    await then('every paragraph Word numbers has an identity with Word\'s label, and the rest have none', () => {
      expect(identities.map(label)).toEqual(fixture.paragraphs.map((p) => p.word));
      expect(identities[0]).toBe('10:0:ARTICLE I');
      expect(identities[1]).toBe('10:1:Section 1.01');
    });
  });

  test('renders the 28th lowerLetter item as "bb"', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.59' });
    const numberingXml = `<w:numbering xmlns:w="${W_NS}">`
      + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">'
      + '<w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/>'
      + '</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    const paragraph = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
      + '<w:r><w:t>Item</w:t></w:r></w:p>';
    let identities: string[] = [];
    await given('a lowerLetter list of 28 paragraphs', () => {});
    await when('compare computes numbering identities', () => {
      identities = identitiesInOrder(documentBody(paragraph.repeat(28)), numberingXml);
    });
    await then('items 27 and 28 read (aa) and (bb), as Word numbers them', () => {
      expect(identities.slice(25).map(label)).toEqual(['(z)', '(aa)', '(bb)']);
    });
  });

  test('tells a style-numbered heading from an unnumbered paragraph with the same text', async ({ given, when, then }: AllureBddContext) => {
    const oracle = evidence(1244);
    const heading = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Notices</w:t></w:r></w:p>';
    const plain = '<w:p><w:r><w:t>Notices</w:t></w:r></w:p>';
    const original = documentBody(heading + plain);
    const revised = documentBody(plain);
    const [headingOriginal, plainOriginal] = Array.from(original.getElementsByTagNameNS(W_NS, 'p'));
    const tagged = (stylesXml: string | undefined) => constructTaggedTree(original, revised, {
      detectMoves: false,
      originalNumberingXml: oracle.numberingXml,
      revisedNumberingXml: oracle.numberingXml,
      originalStylesXml: stylesXml,
      revisedStylesXml: stylesXml,
    }).tree.children;
    let withoutStyles: ReturnType<typeof tagged> = [];
    let withStyles: ReturnType<typeof tagged> = [];
    await given('an "ARTICLE I" heading numbered only through its Heading1 style, then an unnumbered "Notices"; the revision keeps the unnumbered one', () => {});
    await when('the tagged tree is constructed with and without the styles parts', () => {
      withoutStyles = tagged(undefined);
      withStyles = tagged(oracle.stylesXml);
    });
    await then('only the styles part lets the heading\'s identity keep it from pairing with the unnumbered paragraph', () => {
      expect(withoutStyles[0]?.tag === 'both' ? withoutStyles[0].original : undefined).toBe(headingOriginal);
      expect(withStyles.map((child) => child.tag)).toEqual(['original', 'both']);
      expect(withStyles[0]?.tag === 'original' ? withStyles[0].node : undefined).toBe(headingOriginal);
      expect(withStyles[1]?.tag === 'both' ? withStyles[1].original : undefined).toBe(plainOriginal);
    });
  });

  test('pairs a clause renumbered by an inserted clause instead of deleting and reinserting it', async ({ given, when, then }: AllureBddContext) => {
    const numberingXml = `<w:numbering xmlns:w="${W_NS}">`
      + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">'
      + '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>'
      + '</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    const clause = (text: string) => '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
      + `<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const original = documentBody(clause('The Company shall give notice in writing.'));
    const revised = documentBody(
      clause('The Investors shall consent in advance.') + clause('The Company shall give notice in writing.'),
    );
    let children: ReturnType<typeof constructTaggedTree>['tree']['children'] = [];
    await given('a clause numbered 1., and a revision that inserts a new clause above it, so it renders as 2.', () => {});
    await when('the tagged tree is constructed', () => {
      children = constructTaggedTree(original, revised, {
        detectMoves: false,
        originalNumberingXml: numberingXml,
        revisedNumberingXml: numberingXml,
      }).tree.children;
    });
    await then('only the new clause is inserted; the renumbered clause stays paired', () => {
      expect(children.map((child) => child.tag)).toEqual(['revised', 'both']);
      expect(children[1]?.tag === 'both' ? children[1].revised.textContent : undefined)
        .toBe('The Company shall give notice in writing.');
    });
  });
});
