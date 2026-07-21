import { describe, expect } from 'vitest';
import { testAllure } from './allure-test.js';
import {
  revisionEvidence,
  revisionEvidenceCases,
  type RevisionEvidenceContext,
} from './revision-evidence.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Revision Evidence Contract' });

interface Fixture {
  stories: Record<string, string>;
}

interface Run {
  operation: string;
  mode?: string;
  stories: Record<string, string>;
}

function execute(fixture: Fixture, context: RevisionEvidenceContext): Run {
  const stories = { ...fixture.stories };
  const [operation = '', mode] = context.operation.split('.');
  const input = stories[context.story] ?? '';
  if (operation === 'accept') stories[context.story] = input.replace('<ins>target</ins>', 'target');
  if (operation === 'reject') stories[context.story] = input.replace('<ins>target</ins>', '');
  if (operation === 'validate') stories[context.story] = input.includes('<ins>target</ins>') ? 'valid:target' : 'invalid';
  if (operation === 'compare' || operation === 'reconstruct') {
    stories[context.story] = `${mode}:${input}`;
  }
  return { operation, mode, stories };
}

function baseFactory(overrides: Partial<Parameters<typeof revisionEvidenceCases<Fixture, Run>>[0]> = {}) {
  return revisionEvidenceCases<Fixture, Run>({
    elements: ['ins'],
    operations: ['accept'],
    story: 'main',
    buildFixture: () => ({ stories: { main: '<ins>target</ins>', footnote: '' } }),
    run: (fixture, _element, context) => execute(fixture, context),
    observe: (run) => run.stories.main === 'target',
    mutations: () => [
      {
        name: 'remove-target',
        apply: (fixture, context) => ({
          fixture: { stories: { ...fixture.stories, main: '' } },
          context,
        }),
      },
      {
        name: 'corrupt-target',
        apply: (fixture, context) => ({
          fixture: { stories: { ...fixture.stories, main: '<ins>corrupt</ins>' } },
          context,
        }),
      },
    ],
    ...overrides,
  });
}

describe('revision evidence contract', () => {
  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects target-presence-only evidence', async () => {
    const cases = baseFactory({
      run: (fixture) => ({ operation: 'accept', stories: fixture.stories }),
      observe: (run) => (run.stories.main ?? '').includes('<ins>'),
    });
    await expect(revisionEvidence('TARGET-PRESENCE', cases)).rejects.toThrow(/corrupt-target/);
  });

  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects accept output reused for reject', async () => {
    const accepted = execute({ stories: { main: '<ins>target</ins>' } }, { operation: 'accept', story: 'main' });
    const cases = baseFactory({
      operations: ['reject'],
      run: () => accepted,
      observe: (run) => run.stories.main === '',
    });
    await expect(revisionEvidence('WRONG-OPERATION', cases)).rejects.toThrow(/WRONG-OPERATION/);
  });

  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects a main fixture relabeled as footnote evidence', async () => {
    const mainRun = execute(
      { stories: { main: '<ins>target</ins>', footnote: '' } },
      { operation: 'accept', story: 'main' },
    );
    const cases = baseFactory({
      story: 'footnote',
      run: () => mainRun,
      observe: (run) => run.stories.footnote === 'target',
    });
    await expect(revisionEvidence('WRONG-STORY', cases)).rejects.toThrow(/WRONG-STORY/);
  });

  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects inplace output reused for rebuild', async () => {
    const inplace = execute(
      { stories: { main: '<ins>target</ins>' } },
      { operation: 'reconstruct.inplace', story: 'main' },
    );
    const cases = baseFactory({
      operations: ['reconstruct.rebuild'],
      run: () => inplace,
      observe: (run) => run.mode === 'rebuild' && (run.stories.main ?? '').startsWith('rebuild:'),
    });
    await expect(revisionEvidence('WRONG-MODE', cases)).rejects.toThrow(/WRONG-MODE/);
  });

  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects removed and corrupt targets after real reruns', async () => {
    const cases = baseFactory({
      mutations: () => [
        {
          name: 'remove-target',
          apply: (fixture, context) => ({ fixture: { stories: { ...fixture.stories, main: '' } }, context }),
        },
        {
          name: 'corrupt-target',
          apply: (fixture, context) => ({
            fixture: { stories: { ...fixture.stories, main: '<ins>corrupt</ins>' } },
            context,
          }),
        },
      ],
    });
    const evidenceOutput = process.env.SDX_REVISION_EVIDENCE_RESULTS;
    delete process.env.SDX_REVISION_EVIDENCE_RESULTS;
    try {
      await expect(revisionEvidence('REAL-RERUN', cases)).resolves.toBeUndefined();
    } finally {
      if (evidenceOutput !== undefined) process.env.SDX_REVISION_EVIDENCE_RESULTS = evidenceOutput;
    }
  });
});
