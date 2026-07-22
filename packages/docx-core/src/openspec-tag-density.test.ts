import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { assertDefined } from './testing/test-utils.js';
import { analyzeFile } from '../scripts/validate_openspec_tag_density.mjs';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'OpenSpec Tag Density Guard' });

// Build fixture test source without ever writing a literal openspec-tag call in
// this file, so the regex-based coverage/quality validators don't mistake these
// synthetic scenarios for real traceability mappings. `analyzeFile` parses the
// assembled string with the TS compiler, so the runtime source is what matters.
const OPENSPEC = '.openspec';
function tag(id: string, text: string): string {
  return `${OPENSPEC}('[${id}] ${text}')`;
}

function buildTestFile(tags: string[], opts: { leading?: string } = {}): string {
  const chain = tags.length > 0 ? `\n    ${tags.join('\n    ')}` : '';
  return [
    "import { testAllure } from './testing/allure-test.js';",
    "const test = testAllure.epic('E');",
    "describe('density fixture', () => {",
    opts.leading ? `  ${opts.leading}` : '',
    `  test${chain}(`,
    "    'a clustered scenario test',",
    '    async () => {},',
    '  );',
    '});',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

describe('analyzeFile — openspec tag-density detector', () => {
  test(
    '3+ tags without a coverage-rationale is reported as a violation',
    async ({ given, when, then }: AllureBddContext) => {
      let findings: ReturnType<typeof analyzeFile>;

      await given('a test carrying three openspec tags and no rationale', () => {});

      await when('the file is analyzed at the default threshold', () => {
        const source = buildTestFile([
          tag('FAKE-01', 'first facet'),
          tag('FAKE-02', 'second facet'),
          tag('FAKE-03', 'third facet'),
        ]);
        findings = analyzeFile('fixture.test.ts', source);
      });

      await then('it surfaces one high-density finding with no rationale', () => {
        expect(findings).toHaveLength(1);
        const [finding] = findings;
        assertDefined(finding);
        expect(finding.tagCount).toBe(3);
        expect(finding.hasRationale).toBe(false);
        expect(finding.emptyRationale).toBe(false);
        expect(finding.label).toBe('a clustered scenario test');
      });
    },
  );

  test(
    'a leading // coverage-rationale comment clears the violation',
    async ({ given, when, then }: AllureBddContext) => {
      let findings: ReturnType<typeof analyzeFile>;

      await given('the same three-tag test with an adjacent coverage-rationale', () => {});

      await when('the file is analyzed', () => {
        const source = buildTestFile(
          [tag('FAKE-01', 'first facet'), tag('FAKE-02', 'second facet'), tag('FAKE-03', 'third facet')],
          { leading: '// coverage-rationale: one property run exercises all three facets.' },
        );
        findings = analyzeFile('fixture.test.ts', source);
      });

      await then('the finding is marked as carrying a rationale', () => {
        expect(findings).toHaveLength(1);
        const [finding] = findings;
        assertDefined(finding);
        expect(finding.hasRationale).toBe(true);
        expect(finding.emptyRationale).toBe(false);
      });
    },
  );

  test(
    'a @coverage-rationale JSDoc tag is also recognized',
    async ({ given, when, then }: AllureBddContext) => {
      let findings: ReturnType<typeof analyzeFile>;

      await given('a three-tag test annotated via a JSDoc block', () => {});

      await when('the file is analyzed', () => {
        const source = buildTestFile(
          [tag('FAKE-01', 'a'), tag('FAKE-02', 'b'), tag('FAKE-03', 'c')],
          { leading: '/**\n   * @coverage-rationale these three are one lemma cluster.\n   */' },
        );
        findings = analyzeFile('fixture.test.ts', source);
      });

      await then('the rationale is detected', () => {
        expect(findings).toHaveLength(1);
        const [finding] = findings;
        assertDefined(finding);
        expect(finding.hasRationale).toBe(true);
      });
    },
  );

  test(
    'an empty coverage-rationale marker is reported as empty, not satisfied',
    async ({ given, when, then }: AllureBddContext) => {
      let findings: ReturnType<typeof analyzeFile>;

      await given('a three-tag test whose rationale comment has no prose', () => {});

      await when('the file is analyzed', () => {
        const source = buildTestFile(
          [tag('FAKE-01', 'a'), tag('FAKE-02', 'b'), tag('FAKE-03', 'c')],
          { leading: '// coverage-rationale:' },
        );
        findings = analyzeFile('fixture.test.ts', source);
      });

      await then('it is flagged with an empty rationale and remains a violation', () => {
        expect(findings).toHaveLength(1);
        const [finding] = findings;
        assertDefined(finding);
        expect(finding.hasRationale).toBe(false);
        expect(finding.emptyRationale).toBe(true);
      });
    },
  );

  test(
    'a test below the threshold is never reported',
    async ({ given, when, then }: AllureBddContext) => {
      let findings: ReturnType<typeof analyzeFile>;

      await given('a test carrying only two openspec tags', () => {});

      await when('the file is analyzed at the default threshold', () => {
        const source = buildTestFile([tag('FAKE-01', 'a'), tag('FAKE-02', 'b')]);
        findings = analyzeFile('fixture.test.ts', source);
      });

      await then('no findings are produced', () => {
        expect(findings).toHaveLength(0);
      });
    },
  );

  test(
    'openspec mentions inside strings and comments are not counted',
    async ({ given, when, then }: AllureBddContext) => {
      let findings: ReturnType<typeof analyzeFile>;

      await given('a single-tag test whose body merely mentions openspec in a string', () => {});

      await when('the file is analyzed', () => {
        // One real tag plus decoy openspec-tag text embedded in a string and a
        // comment — only the AST-level call should count, keeping this below 3.
        const decoy = `${OPENSPEC}('[NOPE-01] not a real call')`;
        const source = [
          "import { testAllure } from './testing/allure-test.js';",
          "const test = testAllure.epic('E');",
          "describe('d', () => {",
          `  test${tag('FAKE-01', 'only real tag')}(`,
          "    'one tag plus decoys',",
          '    async () => {',
          `      const note = ${JSON.stringify(decoy)};`,
          `      // ${decoy}`,
          '      void note;',
          '    },',
          '  );',
          '});',
          '',
        ].join('\n');
        findings = analyzeFile('fixture.test.ts', source);
      });

      await then('the decoys are ignored and the test stays below threshold', () => {
        expect(findings).toHaveLength(0);
      });
    },
  );

  test(
    'the custom threshold argument is respected',
    async ({ given, when, then }: AllureBddContext) => {
      let atTwo: ReturnType<typeof analyzeFile>;
      let atFive: ReturnType<typeof analyzeFile>;

      await given('a four-tag test', () => {});

      await when('analyzed at threshold 2 and threshold 5', () => {
        const source = buildTestFile([
          tag('FAKE-01', 'a'),
          tag('FAKE-02', 'b'),
          tag('FAKE-03', 'c'),
          tag('FAKE-04', 'd'),
        ]);
        atTwo = analyzeFile('fixture.test.ts', source, 2);
        atFive = analyzeFile('fixture.test.ts', source, 5);
      });

      await then('it is a violation at 2 but ignored at 5', () => {
        expect(atTwo).toHaveLength(1);
        const [finding] = atTwo;
        assertDefined(finding);
        expect(finding.tagCount).toBe(4);
        expect(atFive).toHaveLength(0);
      });
    },
  );
});
