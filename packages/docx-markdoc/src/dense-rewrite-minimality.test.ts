/**
 * Dense brownfield rewrites must not revise preservable common tokens (#846).
 *
 * The independent release verifier can prove exact accept/reject projection
 * while still finding ordinary source tokens that the emitted tracked document
 * needlessly deletes and reinserts. Before the fix, a dense whole-paragraph
 * rewrite whose word overlap fell below the comparison engine's paragraph
 * similarity heuristics degraded to a coarse whole-paragraph delete + insert,
 * and repeated nearby terms (inter-word spaces included) could survive as the
 * occurrence the verifier does not credit. These tests compile canonical
 * before/after Markdoc through the real emitter and judge the tracked output
 * with the checker-owned oracle — `emittedRedlineMinimality` from
 * `docx-release-verifier` — never with expectations derived from the emitter.
 *
 * All fixture prose is synthetic: invented entity names, generic obligations.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/846
 */
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { emittedRedlineMinimality } from '../../docx-release-verifier/src/minimality.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const CONTEXT = 'Context paragraph.';

/**
 * Compile a single-paragraph canonical rewrite and score the emitted tracked
 * document with the independent verifier's minimality oracle.
 */
async function compileAndScore(before: string, after: string) {
  const original = await buildSyntheticDocx({ paragraphs: [before, CONTEXT] });
  const imported = await importDocxToMarkdoc(original);
  const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
  const replaceBlock = [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', after, '{% /after %}',
    '{% /change %}',
  ].join('\n');
  const firstBlock = new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`);
  const markdoc = imported.markdoc.replace(firstBlock, replaceBlock);
  const result = await compileMarkdoc(imported.anchoredSource, markdoc);
  const zip = await JSZip.loadAsync(result.tracked);
  const trackedXml = await zip.file('word/document.xml')!.async('string');
  const evidence = emittedRedlineMinimality([before, CONTEXT], [after, CONTEXT], trackedXml);
  return { certificate: result.certificate, trackedXml, evidence };
}

function expectZeroLoss(evidence: Awaited<ReturnType<typeof compileAndScore>>['evidence']): void {
  expect(evidence.lostTokensByClass.lexical).toBe(0);
  expect(evidence.lostTokensByClass.punctuation).toBe(0);
  expect(evidence.passed).toBe(true);
  expect(evidence.lostTokens).toBe(0);
  expect(evidence.unresolvedTopologyParagraphs).toBe(0);
}

describe('dense rewrite token minimality', () => {
  itAllure('[SDX-MDOC-05][SDX-MDOC-13] preserves a retained adjective and entity phrase inside a larger rewrite', async () => {
    // Retained: "diligent" (adjective) and "Meridian Fund" (entity phrase),
    // surrounded on both sides by a rewrite dense enough that the paragraph
    // pair fails every text-similarity heuristic (pre-fix loss: 3 lexical,
    // 1 punctuation via whole-paragraph delete + insert).
    const { certificate, evidence } = await compileAndScore(
      'The diligent Meridian Fund team prepared the annual summary.',
      'Whenever practicable going forward, our diligent colleagues within the Meridian Fund will personally assemble and distribute every quarterly digest.',
    );
    expect(certificate.passed).toBe(true);
    expectZeroLoss(evidence);
  });

  itAllure('[SDX-MDOC-05][SDX-MDOC-13] preserves a possessive entity reference and conjunction amid repeated nearby terms', async () => {
    // Retained: one "Harbor Ltd's" possessive reference and the conjunction
    // "and", while the source repeats "Harbor Ltd's" three times and the
    // revision repeats "and" — multiple valid LCS alignments exist (pre-fix
    // loss: 4 lexical, 2 punctuation).
    const { certificate, evidence } = await compileAndScore(
      "Harbor Ltd's agent and Harbor Ltd's counsel review Harbor Ltd's filings.",
      "Effective immediately, Harbor Ltd's designated compliance officers and their delegates supervise every submission, disclosure, and records package.",
    );
    expect(certificate.passed).toBe(true);
    expectZeroLoss(evidence);
  });

  itAllure('[SDX-MDOC-05][SDX-MDOC-13] preserves a retained entity noun and its adjacent comma amid a dense replacement', async () => {
    // Retained: "Northwind" and the comma that follows it, amid a replacement
    // dense enough to defeat similarity alignment, with repeated commas and
    // repeated "and"/"its" nearby (pre-fix loss: 5 lexical, 4 punctuation).
    const { certificate, evidence } = await compileAndScore(
      'Subject to approval, Northwind, together with its affiliates, will fund the program.',
      'Notwithstanding any contrary term, Northwind, acting through its designated affiliates and subsidiaries, shall exclusively finance and administer the entire program.',
    );
    expect(certificate.passed).toBe(true);
    expectZeroLoss(evidence);
  });

  itAllure('[SDX-MDOC-05][SDX-MDOC-13] does not match two source occurrences of a repeated token to one emitted occurrence', async () => {
    // "agent" appears twice in the source and once in the revision. The
    // verifier's crediting is injective, so a passing verdict proves the one
    // surviving ordinary "agent" is not double-counted; the tracked XML must
    // also physically delete the second occurrence rather than absorb it.
    const { certificate, evidence, trackedXml } = await compileAndScore(
      'The agent shall pay the agent fee before closing.',
      'The agent shall pay the closing fee.',
    );
    expect(certificate.passed).toBe(true);
    expectZeroLoss(evidence);
    const deletedAgents = [...trackedXml.matchAll(/<w:delText[^>]*>[^<]*agent[^<]*<\/w:delText>/gu)];
    expect(deletedAgents).toHaveLength(1);
    const allAgents = [...trackedXml.matchAll(/agent/gu)];
    expect(allAgents).toHaveLength(2);
  });

  itAllure('[SDX-MDOC-05][SDX-MDOC-13] does not credit one source occurrence against two emitted occurrences', async () => {
    // "Custodian" appears once in the source and twice in the revision. The
    // second occurrence must be a genuine insertion, not a phantom
    // preservation of the single source token.
    const { certificate, evidence, trackedXml } = await compileAndScore(
      'Notice must be delivered to the Custodian.',
      'Notice must be delivered to the Custodian, and the Custodian must acknowledge receipt.',
    );
    expect(certificate.passed).toBe(true);
    expectZeroLoss(evidence);
    const insertionBlocks = [...trackedXml.matchAll(/<w:ins\b[\s\S]*?<\/w:ins>/gu)].map((match) => match[0]);
    expect(insertionBlocks.filter((block) => block.includes('Custodian'))).toHaveLength(1);
    const allCustodians = [...trackedXml.matchAll(/Custodian/gu)];
    expect(allCustodians).toHaveLength(2);
  });
});
