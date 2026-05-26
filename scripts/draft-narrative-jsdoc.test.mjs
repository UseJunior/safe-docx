import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assemblePrompt,
  extractFirstJsonObject,
  formatJsDocBlock,
  inferFeatureLabel,
  insertJsDocAboveScenario,
  parseAndValidateCodexOutput,
  REFUSED_EXISTING_JSDOC
} from './draft-narrative-jsdoc.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SCRIPT_PATH = path.join(SCRIPT_DIR, 'draft-narrative-jsdoc.mjs');

const validNarrative = [
  'People reviewing DOCX comparison behavior need to understand why a public scenario exists beyond simply checking a helper branch.',
  'This case explains the user-visible risk, the document evidence involved, and the expected behavior in enough detail for a corpus reader.',
  'It stays tied to the extracted Given, When, and Then steps instead of inventing broader product claims or unrelated format guarantees.'
].join(' ');

function fakeValidateTags(value) {
  if (!value || typeof value.motivatingProblem !== 'string') {
    return {
      success: false,
      error: { issues: [{ path: ['motivatingProblem'], message: 'motivatingProblem is required when visibility is public' }] }
    };
  }
  return { success: true, data: value };
}

test('dry-run prints scenario summaries and does not modify the input file', () => {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-narrative-package-'));
  const stubPath = path.join(stubDir, 'index.js');
  fs.writeFileSync(
    stubPath,
    `export function extractScenarios(file) {
  return [{
    scenarioName: 'drafts missing narrative',
    sourceRef: { path: file, line: 8 },
    visibility: 'public',
    narrative: {},
    bddSteps: [
      { keyword: 'given', value: { kind: 'literal', value: 'a public test without narrative' }, sourceRef: { path: file, line: 9 } },
      { keyword: 'when', value: { kind: 'literal', value: 'the local drafter inspects the scenario' }, sourceRef: { path: file, line: 10 } },
      { keyword: 'then', value: { kind: 'literal', value: 'it prepares a prompt for Codex' }, sourceRef: { path: file, line: 11 } }
    ],
    fixtures: [],
    expectArgs: []
  }];
}

export function validateTags(value) {
  return { success: true, data: value };
}
`
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-narrative-jsdoc-'));
  const fixture = path.join(tmp, 'fixture.test.ts');
  const source = `const test = {
  openspec: () => (metadata) => (name, fn) => fn({
    given() {},
    when() {},
    then() {}
  })
};

test.openspec('feature-docx')({ visibility: 'public' })('drafts missing narrative', ({ given, when, then }) => {
  given('a public test without narrative');
  when('the local drafter inspects the scenario');
  then('it prepares a prompt for Codex');
});
`;
  fs.writeFileSync(fixture, source);

  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--dry-run', fixture], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SAFE_DOCX_TEST_NARRATIVE_DIST: stubPath
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scenario: drafts missing narrative/);
  assert.match(result.stdout, /missing tags: motivatingProblem/);
  assert.match(result.stdout, /"scenarioName": "drafts missing narrative"/);
  assert.equal(fs.readFileSync(fixture, 'utf8'), source);
});

test('extractFirstJsonObject returns the first balanced JSON object', () => {
  assert.equal(extractFirstJsonObject(`preamble\n{"a":"brace } in string","b":{"c":1}}\nextra`), '{"a":"brace } in string","b":{"c":1}}');
});

test('parseAndValidateCodexOutput parses preamble output and returns validated tags', () => {
  const parsed = parseAndValidateCodexOutput(`draft:\n${JSON.stringify({ motivatingProblem: validNarrative })}`, fakeValidateTags);
  assert.deepEqual(parsed, { motivatingProblem: validNarrative });
});

test('parseAndValidateCodexOutput reports schema failures', () => {
  assert.throws(
    () => parseAndValidateCodexOutput('{"implementationLimitation":"unsupported"}', fakeValidateTags),
    /motivatingProblem is required when visibility is public/
  );
});

test('insertJsDocAboveScenario inserts with matching indentation', () => {
  const source = `describe('feature', () => {
  test.openspec('feature-docx')({ visibility: 'public' })('name', () => {});
});
`;
  const patched = insertJsDocAboveScenario(source, 2, { motivatingProblem: validNarrative });
  assert.equal(
    patched,
    `describe('feature', () => {
  /**
   * @motivatingProblem ${validNarrative}
   */
  test.openspec('feature-docx')({ visibility: 'public' })('name', () => {});
});
`
  );
});

test('formatJsDocBlock escapes comment terminators', () => {
  assert.equal(
    formatJsDocBlock({ motivatingProblem: 'before */ after' }, '  '),
    `  /**
   * @motivatingProblem before * / after
   */`
  );
});

test('assemblePrompt replaces the context placeholder', () => {
  const prompt = assemblePrompt('start\n<<INPUT_CONTEXT_JSON>>\nend', { scenarioName: 'example' });
  assert.match(prompt, /"scenarioName": "example"/);
  assert.doesNotMatch(prompt, /<<INPUT_CONTEXT_JSON>>/);
});

test('inferFeatureLabel reads the nearest openspec string argument', () => {
  const source = `test.openspec('alpha')({ visibility: 'public' })('one', () => {});
test.openspec('beta')({ visibility: 'public' })('two', () => {});
`;
  assert.equal(inferFeatureLabel(source, 1), 'alpha');
  assert.equal(inferFeatureLabel(source, 2), 'beta');
});

test('insertJsDocAboveScenario refuses to patch when a JSDoc block already exists', () => {
  // Regression for Codex/Gemini peer review (PR #249): the helper used to
  // insert a SECOND JSDoc block above an existing one. That stacks blocks
  // and orphans the original. New behavior: return REFUSED_EXISTING_JSDOC
  // and let the caller surface a "please update manually" message.
  const source = [
    `/**`,
    ` * @implementationLimitation This scenario is intentionally narrow because the suite covers wider cases elsewhere with sibling stories.`,
    ` */`,
    `test.openspec('scenario-id')({ visibility: 'public' })('Scenario: name', async () => {});`,
    ``
  ].join('\n');
  const result = insertJsDocAboveScenario(source, 4, { motivatingProblem: 'some valid problem statement' });
  assert.equal(result, REFUSED_EXISTING_JSDOC);
});

test('insertJsDocAboveScenario preserves CRLF line endings when patching a CRLF file', () => {
  // Regression for Codex/Gemini peer review (PR #249): the helper used to
  // split on /\r?\n/ and rejoin with '\n', silently rewriting a CRLF file
  // to LF.
  const lines = [
    `import { describe } from 'vitest';`,
    ``,
    `test.openspec('id')({ visibility: 'public' })('Scenario: a', async () => {});`,
    ``
  ];
  const source = lines.join('\r\n');
  const result = insertJsDocAboveScenario(source, 3, { motivatingProblem: 'a valid grounded problem statement' });
  assert.notEqual(result, REFUSED_EXISTING_JSDOC);
  assert.ok(typeof result === 'string');
  assert.ok(result.includes('\r\n'), 'patched output should keep CRLF line endings');
  // No bare LF outside of CRLF pairs (every \n is preceded by \r).
  for (let i = 0; i < result.length; i += 1) {
    if (result[i] === '\n') {
      assert.equal(result[i - 1], '\r', `bare LF at index ${i}`);
    }
  }
});
