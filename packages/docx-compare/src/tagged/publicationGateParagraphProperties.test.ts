/**
 * The publication gate's paragraph-property parity checks (#1493).
 *
 * A redline that deletes the wrong paragraph mark keeps every character in
 * place, so the text and topology checks pass while Accept All loses a page
 * break or an alignment. These cases run real comparisons; the fault cases
 * tamper with the emitted document before the gate reads it, so the failure
 * observed is the gate's own, and the control cases prove legitimate output
 * still publishes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/1493
 */

import { describe, expect } from 'vitest';
import { DocxArchive } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  compareDocumentsAtomizer,
  evaluateSafetyChecks,
  TaggedPublicationSafetyError,
} from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { compareParagraphProperties, paragraphPropertySignature, stampSurvivingMarkProperties } from './paragraphPropertyParity.js';
import { parseDocumentXml, serializeToXml } from './xmlToWmlElement.js';

const TEST_FEATURE = 'publication-gate-paragraph-property-parity';
const OPTIONS = { author: 'Gate Fault Injection', date: new Date('2026-11-16T00:00:00Z') };

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Publication Gate Paragraph Properties',
    severity: 'critical',
  })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (value: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
const LEFT = '<w:jc w:val="left"/>';
const HEAD = p('The parties sign below.') + p('SIGNATORY:', `<w:pageBreakBefore/>${LEFT}`);
/** The issue's synthetic repro. */
const ISSUE_BASE = HEAD + p('[NAME OF SIGNATORY]', LEFT) + p('By: ________', LEFT) + p('Name: ________', LEFT);
const ISSUE_REVISED = HEAD + p('ALPHA LP', LEFT) + p('By: Beta LLC, its general partner', LEFT) +
  p('By: ________', LEFT) + p('Name: Jane Roe', LEFT);

interface Outcome {
  error?: TaggedPublicationSafetyError;
  documentXml?: string;
  tampered: boolean;
}

async function compare(
  originalBody: string,
  revisedBody: string,
  tamper: (xml: string) => string = (xml) => xml,
  detectFormatChanges = true,
): Promise<Outcome> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  let tampered = false;
  try {
    const result = await compareDocumentsAtomizer(original, revised, {
      ...OPTIONS,
      formatDetection: { detectFormatChanges },
      taggedTreePublicationSafetyEvaluator: (a, b, c, d, candidateXml, sidecars, topology, properties) => {
        const rewritten = tamper(candidateXml);
        tampered = rewritten !== candidateXml;
        return evaluateSafetyChecks(a, b, c, d, rewritten, sidecars, topology, properties);
      },
    });
    const archive = await DocxArchive.load(result.document);
    return { documentXml: await archive.getDocumentXml(), tampered };
  } catch (error) {
    if (error instanceof TaggedPublicationSafetyError) return { error, tampered };
    throw error;
  }
}

/** Move the deleted mark of the paragraph holding `deleted` onto the one holding `kept`: the pre-fix shape. */
function relocateDeletedMark(kept: string, deleted: string) {
  return (xml: string): string => {
    const root = parseDocumentXml(xml);
    const paragraphs = Array.from(root.getElementsByTagNameNS(W, 'p'));
    const holding = (value: string) => paragraphs.find((paragraph) => paragraph.textContent?.includes(value))!;
    const source = holding(deleted);
    const target = holding(kept);
    const marker = Array.from(source.getElementsByTagNameNS(W, 'rPr'))
      .find((rPr) => (rPr.parentNode as Element).localName === 'pPr')
      ?.getElementsByTagNameNS(W, 'del')[0];
    if (!marker) return xml;
    const markRPr = marker.parentNode as Element;
    markRPr.removeChild(marker);
    if (markRPr.childNodes.length === 0) markRPr.parentNode!.removeChild(markRPr);
    const targetPPr = target.getElementsByTagNameNS(W, 'pPr')[0]!;
    const rPr = root.ownerDocument!.createElementNS(W, 'w:rPr');
    rPr.appendChild(marker);
    targetPPr.appendChild(rPr);
    return serializeToXml(root);
  };
}

function paragraphHoldingIn(root: Element, value: string): Element {
  return Array.from(root.getElementsByTagNameNS(W, 'p')).find((paragraph) => paragraph.textContent === value)!;
}

function paragraphHolding(xml: string, value: string): Element {
  return Array.from(parseDocumentXml(xml).getElementsByTagNameNS(W, 'p'))
    .find((paragraph) => paragraph.textContent === value)!;
}

describe('publication gate: paragraph-property parity (#1493)', () => {
  test('publishes the issue repro with the page break kept on the heading in both projections',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a kept page-break heading followed by a replaced placeholder and an inserted paragraph', () => undefined);
      const outcome = await when('the documents are compared', () => compare(ISSUE_BASE, ISSUE_REVISED));
      await then('the redline publishes and both projections keep the page break on SIGNATORY:', () => {
        expect(outcome.error).toBeUndefined();
        for (const projected of [acceptAllChanges(outcome.documentXml!), rejectAllChanges(outcome.documentXml!)]) {
          const heading = paragraphHolding(projected, 'SIGNATORY:');
          expect(heading.getElementsByTagNameNS(W, 'pageBreakBefore')).toHaveLength(1);
        }
        // The deleted placeholder's own mark is the one deleted.
        const placeholder = Array.from(parseDocumentXml(outcome.documentXml!).getElementsByTagNameNS(W, 'p'))
          .find((paragraph) => paragraph.textContent === '[NAME OF SIGNATORY]')!;
        expect(placeholder.getElementsByTagNameNS(W, 'pPr')[0]!.getElementsByTagNameNS(W, 'del')).toHaveLength(1);
      });
    });

  test('fails acceptParagraphProperties when the kept heading carries the deleted mark (the pre-fix shape)',
    async ({ when, then }: AllureBddContext) => {
      const outcome = await when('the deleted mark is moved onto the heading before the gate reads it', () =>
        compare(ISSUE_BASE, ISSUE_REVISED, relocateDeletedMark('SIGNATORY:', '[NAME OF SIGNATORY]')));
      await then('only the accept-side property check fails', () => {
        expect(outcome.tampered).toBe(true);
        expect(outcome.error?.failedChecks).toEqual(['acceptParagraphProperties']);
        const details = outcome.error!.failureDetails?.acceptParagraphProperties;
        expect(details?.paragraphText).toBe('SIGNATORY:');
        expect(details?.expectedProperties).toContain('pageBreakBefore');
        expect(details?.actualProperties).not.toContain('pageBreakBefore');
      });
    });

  test('measures the same merge target as the acceptor across a block-level bookmark',
    async ({ when, then }: AllureBddContext) => {
      const withGap = (xml: string): string => {
        const relocated = relocateDeletedMark('SIGNATORY:', '[NAME OF SIGNATORY]')(xml);
        const root = parseDocumentXml(relocated);
        const heading = paragraphHoldingIn(root, 'SIGNATORY:');
        const document = root.ownerDocument!;
        const start = document.createElementNS(W, 'w:bookmarkStart');
        start.setAttributeNS(W, 'w:id', '9001');
        start.setAttributeNS(W, 'w:name', 'gap');
        const end = document.createElementNS(W, 'w:bookmarkEnd');
        end.setAttributeNS(W, 'w:id', '9001');
        heading.parentNode!.insertBefore(end, heading.nextSibling);
        heading.parentNode!.insertBefore(start, end);
        return serializeToXml(root);
      };
      const outcome = await when('the wrong-mark fault has a bookmark between the merged paragraphs', () =>
        compare(ISSUE_BASE, ISSUE_REVISED, withGap));
      await then('the accept-side property check still fails', () => {
        expect(outcome.tampered).toBe(true);
        expect(outcome.error?.failedChecks).toContain('acceptParagraphProperties');
      });
    });

  test('fails both property checks when a kept paragraph loses a property outright',
    async ({ when, then }: AllureBddContext) => {
      const outcome = await when('the page break is removed from the emitted heading', () =>
        compare(ISSUE_BASE, ISSUE_REVISED, (xml) => xml.replace('<w:pageBreakBefore/>', '')));
      await then('accept and reject property checks fail, the text checks pass', () => {
        expect(outcome.tampered).toBe(true);
        expect(outcome.error?.failedChecks).toEqual(['acceptParagraphProperties', 'rejectParagraphProperties']);
      });
    });

  test('fails rejectParagraphProperties when a property change loses its w:pPrChange record',
    async ({ when, then }: AllureBddContext) => {
      const outcome = await when('a centred paragraph made left-aligned is compared and its record removed', () =>
        compare(p('Title', '<w:jc w:val="center"/>') + p('Body'), p('Title', LEFT) + p('Body text'),
          (xml) => xml.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/u, '')));
      await then('only the reject-side property check fails', () => {
        expect(outcome.tampered).toBe(true);
        expect(outcome.error?.failedChecks).toEqual(['rejectParagraphProperties']);
      });
    });

  test('publishes a tracked paragraph-property change and a whole-paragraph deletion between equal properties',
    async ({ when, then }: AllureBddContext) => {
      const formatted = await when('a property change and an equal-property deletion are compared', async () => [
        await compare(p('Title', '<w:jc w:val="center"/>') + p('Body'), p('Title', LEFT) + p('Body text')),
        await compare(p('Alpha', LEFT) + p('Bravo', LEFT) + p('Charlie', LEFT), p('Alpha', LEFT) + p('Bravo', LEFT)),
      ]);
      await then('both publish', () => {
        for (const outcome of formatted) expect(outcome.error).toBeUndefined();
      });
    });

  test('holds only Accept All to the revised properties when format detection is off',
    async ({ when, then }: AllureBddContext) => {
      const outcome = await when('a property change is compared with format detection disabled', () =>
        compare(p('Title', '<w:jc w:val="center"/>') + p('Body'), p('Title', LEFT) + p('Body text'), undefined, false));
      await then('the redline publishes', () => expect(outcome.error).toBeUndefined());
    });

  test('judges sources with pending mark history by the same reading as the redline',
    async ({ when, then }: AllureBddContext) => {
      const history = '<w:rPr><w:b/><w:rPrChange w:id="91" w:author="Prior" w:date="2026-01-01T00:00:00Z">' +
        '<w:rPr><w:ins w:id="92" w:author="Prior" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:rPrChange></w:rPr>';
      const body = p('Alpha', `<w:jc w:val="center"/>${history}`) + p('Beta', '<w:jc w:val="right"/>');
      const outcome = await when('a document with a pending inserted-mark snapshot is compared with an edited copy', () =>
        compare(body, body.replace('Beta', 'Beta edited')));
      await then('the redline publishes', () => expect(outcome.error).toBeUndefined());
    });

  test('normalizes rsid attributes, child order and the mark run properties',
    async ({ then }: AllureBddContext) => {
      await then('equivalent w:pPr spellings share one signature and a real difference does not', () => {
        const signature = (pPr: string) => paragraphPropertySignature(
          parseDocumentXml(`<w:p xmlns:w="${W}"><w:pPr>${pPr}</w:pPr></w:p>`));
        expect(signature('<w:keepNext/><w:jc w:val="left"/>')).toBe(
          signature('<w:jc w:val="left"/><w:keepNext/><w:rPr><w:b/><w:del w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:rPr>'));
        expect(signature('<w:ind w:left="720"/>')).toBe(signature('<w:ind w:left="720" w:rsidR="00AB12CD"/>'));
        expect(signature('<w:jc w:val="left"/>')).not.toBe(signature('<w:jc w:val="center"/>'));
        expect(compareParagraphProperties(['a', 'b'], ['a', 'c'], ['x', 'y'])).toMatchObject({
          paragraphIndex: 1, paragraphText: 'y', mismatchedParagraphCount: 1,
        });
      });
    });

  test('stamps a removed mark with the properties of the mark that survives, through chains',
    async ({ then }: AllureBddContext) => {
      await then('each removed mark takes the next surviving paragraph properties', () => {
        const del = '<w:rPr><w:del w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:rPr>';
        const root = parseDocumentXml(`<w:document xmlns:w="${W}"><w:body>` +
          p('A', `<w:pageBreakBefore/>${del}`) + p('B', `${LEFT}${del}`) + p('C', '<w:jc w:val="center"/>') +
          '</w:body></w:document>');
        expect(stampSurvivingMarkProperties(root, 'accept')).toBe(true);
        const paragraphs = Array.from(root.getElementsByTagNameNS(W, 'p'));
        const center = paragraphPropertySignature(paragraphs[2]!);
        expect(paragraphs.map((paragraph) => paragraphPropertySignature(paragraph))).toEqual([center, center, center]);
        expect(paragraphs[0]!.getElementsByTagNameNS(W, 'del')).toHaveLength(1);
        expect(stampSurvivingMarkProperties(root, 'reject')).toBe(false);
      });
    });

  test('stamps a mark whose w:rPrChange snapshot records an insertion on the reject side',
    async ({ then }: AllureBddContext) => {
      await then('Reject All removes that mark, so it takes the surviving mark properties', () => {
        const history = '<w:rPr><w:b/><w:rPrChange w:id="2" w:author="a" w:date="2026-01-01T00:00:00Z">' +
          '<w:rPr><w:ins w:id="3" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:rPrChange></w:rPr>';
        const root = parseDocumentXml(`<w:document xmlns:w="${W}"><w:body>` +
          p('A', `<w:jc w:val="center"/>${history}`) + p('B', '<w:jc w:val="right"/>') + '</w:body></w:document>');
        expect(stampSurvivingMarkProperties(root, 'accept')).toBe(false);
        expect(stampSurvivingMarkProperties(root, 'reject')).toBe(true);
        const [first, second] = Array.from(root.getElementsByTagNameNS(W, 'p'));
        expect(paragraphPropertySignature(first!)).toBe(paragraphPropertySignature(second!));
      });
    });
});
