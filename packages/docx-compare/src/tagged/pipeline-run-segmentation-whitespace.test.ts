/**
 * Identical text split into different runs must not produce revisions, and a
 * whitespace-only run must not carry a format revision unless its own
 * formatting differs between the inputs.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @see https://github.com/UseJunior/safe-docx/issues/743
 */

import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml, completeField } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Run Segmentation Independence',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function run(text: string, properties = '', preserve = /^\s|\s$/u.test(text)): string {
  const space = preserve ? ' xml:space="preserve"' : '';
  const rPr = properties ? `<w:rPr>${properties}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t${space}>${text}</w:t></w:r>`;
}

function paragraph(...runs: string[]): string {
  return `<w:p>${runs.join('')}</w:p>`;
}

function bodyText(bodyXml: string): string {
  return parseXml(`<w:root xmlns:w="${W_NS}">${bodyXml}</w:root>`).documentElement.textContent ?? '';
}

interface Compared {
  xml: string;
  stats: { insertions: number; deletions: number; formatChanges: number };
}

async function compare(originalBody: string, revisedBody: string): Promise<Compared> {
  const result = await compareDocumentsAtomizer(
    await buildDocxFromBodyXml(originalBody),
    await buildDocxFromBodyXml(revisedBody),
    { date: new Date('2026-10-06T12:00:00Z') },
  );
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  return { xml, stats: result.stats };
}

/** Whitespace-only runs that carry `w:rPrChange`. */
function whitespaceFormatRevisions(xml: string): number {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'r')).filter((element) => {
    const text = Array.from(element.childNodes)
      .filter((child) => child.nodeType === 1 && ['t', 'delText'].includes((child as Element).localName))
      .map((child) => child.textContent ?? '')
      .join('');
    return text.length > 0 && text.trim() === '' &&
      element.getElementsByTagNameNS(W_NS, 'rPrChange').length > 0;
  }).length;
}

function expectNoRevisions(compared: Compared): void {
  expect(compared.stats).toMatchObject({ insertions: 0, deletions: 0, formatChanges: 0 });
  for (const name of ['ins', 'del', 'rPrChange', 'moveFrom', 'moveTo']) {
    expect(parseXml(compared.xml).getElementsByTagNameNS(W_NS, name)).toHaveLength(0);
  }
}

function expectProjections(compared: Compared, originalBody: string, revisedBody: string): void {
  expect(extractTextWithParagraphs(acceptAllChanges(compared.xml))).toBe(bodyText(revisedBody));
  expect(extractTextWithParagraphs(rejectAllChanges(compared.xml))).toBe(bodyText(originalBody));
}

describe('run segmentation independence (#743)', () => {
  test('identical currency amounts split at different run boundaries produce no revisions', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const originalBody = await given('a purchase price split one way across runs', () => paragraph(
      run('The Purchase Price is '),
      run('$1,', '<w:b/>'),
      run('000,000', '<w:b/>'),
      run(' payable at the Closing, and the Holdback is $250,000.'),
    ));
    const revisedBody = await given('the same text and formatting split another way', () => paragraph(
      run('The Purchase Price is'),
      run(' '),
      run('$', '<w:b/>'),
      run('1,000', '<w:b/>'),
      run(',000', '<w:b/>'),
      run(' payable at the Closing, and the Holdback is $'),
      run('250,000.'),
    ));

    const compared = await when('the documents are compared', () => compare(originalBody, revisedBody));

    await then('no insertion, deletion, or format revision is emitted', () => {
      expectNoRevisions(compared);
    });
  });

  test('a repeated word in a differently formatted run does not anchor the wrong run', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // From the NVCA Investors' Rights Agreement: splitting `state ` gives the
    // revision a plain `state` run that run-text alignment used to pair with
    // the italic `state` placeholder further along.
    const originalBody = await given('a clause with a plain and an italic `state`', () => paragraph(
      run('Each party consents to jurisdiction in any '),
      run('state '),
      run('court of ['),
      run('state', '<w:i/>'),
      run('] having subject matter jurisdiction.'),
    ));
    const revisedBody = await given('the same clause re-split at its spaces', () => paragraph(
      run('Each party consents to jurisdiction in any '),
      run('state'),
      run(' '),
      run('court'),
      run(' of ['),
      run('state', '<w:i/>'),
      run('] having subject matter jurisdiction.'),
    ));

    const compared = await when('the documents are compared', () => compare(originalBody, revisedBody));

    await then('no revision is emitted', () => {
      expectNoRevisions(compared);
    });
  });

  test('a standalone space run is not anchored to a space split from another run', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // From the NVCA Investors' Rights Agreement `Requisite Holders` definition.
    const lang = '<w:lang w:eastAsia="en-US"/>';
    const originalBody = await given('a definition with a standalone space run', () => paragraph(
      run('“'),
      run('Requisite Holders', '<w:b/>'),
      run('” means the Investors holding a majority of the Preferred Stock'),
      run('; provided that shares held by a Sanctioned Party are disregarded for this', lang),
      run(' '),
      run('definition', lang),
      run('.'),
    ));
    const revisedBody = await given('the same definition re-split, leaving a space run earlier on', () => paragraph(
      run('“'),
      run('Requisite Holders', '<w:b/>'),
      run('” means'),
      run(' '),
      run('the Investors holding a majority of the Preferred Stock'),
      run('; provided that shares held by a Sanctioned Party', lang),
      run(' are disregarded for this', lang),
      run(' '),
      run('definition', lang),
      run('.'),
    ));

    const compared = await when('the documents are compared', () => compare(originalBody, revisedBody));

    await then('no revision is emitted', () => {
      expectNoRevisions(compared);
    });
  });

  test('xml:space on text without edge whitespace does not make identical text a revision', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const originalBody = await given('runs whose text elements declare xml:space="preserve"', () => paragraph(
      run('The Company shall', '', true),
      run(', within ten days,', '', true),
    ));
    const revisedBody = await given('the same runs without the redundant declaration', () => paragraph(
      run('The Company shall', '', false),
      run(', within ten days,', '', false),
    ));

    const compared = await when('the documents are compared', () => compare(originalBody, revisedBody));

    await then('no revision is emitted', () => {
      expectNoRevisions(compared);
    });
  });

  test('a one-word replacement emits no format revision on whitespace-only runs', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const originalBody = await given('a paragraph mixing underlined, bold, and plain runs', () => paragraph(
      run('The '),
      run('Company', '<w:u w:val="single"/>'),
      run(' shall deliver to each '),
      run('Investor', '<w:b/>'),
      run(' a copy of the annual budget within thirty days.'),
    ));
    const revisedBody = await given('one word replaced and the text re-split at spaces', () => paragraph(
      run('The'),
      run(' '),
      run('Company', '<w:u w:val="single"/>'),
      run(' '),
      run('shall deliver to each'),
      run(' '),
      run('Investor', '<w:b/>'),
      run(' '),
      run('a copy of the annual operating budget within thirty days.'),
    ));

    const compared = await when('the documents are compared', () => compare(originalBody, revisedBody));

    await then('exactly one insertion and no deletion or format revision is emitted', () => {
      expect(compared.stats).toMatchObject({ insertions: 1, deletions: 0, formatChanges: 0 });
      expect(whitespaceFormatRevisions(compared.xml)).toBe(0);
    });
    await and('accept and reject reproduce the inputs', () => {
      expectProjections(compared, originalBody, revisedBody);
    });
  });

  test('a phrase inserted after a bold run does not restyle the existing space', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    // From the NVCA ROFR and Co-Sale Agreement recitals: the inserted bold
    // words were aligned with the plain space after `WHEREAS,`, emitting a
    // bold space with `w:rPrChange` — a detached format revision.
    const originalBody = await given('a recital opening with a bold WHEREAS', () => paragraph(
      run('WHEREAS,', '<w:b/>'),
      run(' each Key Holder is the beneficial owner of shares of Capital Stock'),
      run(';'),
    ));
    const revisedBody = await given('bold words inserted after WHEREAS, split at spaces', () => paragraph(
      run('WHEREAS,', '<w:b/>'),
      run(' ', '<w:b/>'),
      run('and', '<w:b/>'),
      run(' ', '<w:b/>'),
      run('further', '<w:b/>'),
      run(' '),
      run('each'),
      run(' '),
      run('Key Holder is the beneficial owner of shares of Capital Stock'),
      run(';'),
    ));

    const compared = await when('the documents are compared', () => compare(originalBody, revisedBody));

    await then('no whitespace-only run carries a format revision', () => {
      expect(whitespaceFormatRevisions(compared.xml)).toBe(0);
      expect(compared.stats).toMatchObject({ deletions: 0, formatChanges: 0 });
    });
    await and('accept and reject reproduce the inputs', () => {
      expectProjections(compared, originalBody, revisedBody);
    });
  });

  test('repeated text inserted before a run with a tab, break, or field keeps that run anchored', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const cases = await given('unchanged structural runs preceded by an insertion of their text', () => [
      { stable: run('alpha', '').replace('</w:t>', '</w:t><w:tab/>'), inserted: 'alpha ' },
      { stable: run('alpha', '').replace('</w:t>', '</w:t><w:br/>'), inserted: 'alpha ' },
      { stable: completeField(' PAGE ', '1'), inserted: ' PAGE 1 ' },
    ]);

    const results = await when('each pair is compared', () => Promise.all(cases.map(({ stable, inserted }) => compare(
      paragraph(stable, run(' beta')),
      paragraph(run(inserted), stable, run(' beta')),
    ))));

    await then('only the inserted text is revised', () => {
      for (const compared of results) {
        expect(compared.stats).toMatchObject({ insertions: 1, deletions: 0, formatChanges: 0 });
      }
    });
  });
});
