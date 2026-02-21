import { expect, it as vitestIt, test as vitestTest } from 'vitest';

export type AllureStepContext = {
  parameter?(name: string, value: string): void | Promise<void>;
};

type AllureStepBody<T> =
  | (() => T | Promise<T>)
  | ((context: AllureStepContext) => T | Promise<T>);

export type AllureRuntime = {
  epic(name: string): void | Promise<void>;
  feature(name: string): void | Promise<void>;
  parentSuite(name: string): void | Promise<void>;
  suite(name: string): void | Promise<void>;
  subSuite?(name: string): void | Promise<void>;
  severity(level: string): void | Promise<void>;
  story(name: string): void | Promise<void>;
  id?(id: string): void | Promise<void>;
  label?(name: string, value: string): void | Promise<void>;
  step<T>(name: string, body: AllureStepBody<T>): Promise<T>;
  parameter?(name: string, value: string): void | Promise<void>;
  attachment?(name: string, content: string, contentType?: string): void | Promise<void>;
};

export function getAllureRuntime(): AllureRuntime | undefined {
  return (globalThis as { allure?: AllureRuntime }).allure;
}

type UnknownFn = (...args: unknown[]) => unknown;
type WrappedTestFn = typeof vitestIt;
type TestName = Parameters<WrappedTestFn>[0];
type TestBody = Parameters<WrappedTestFn>[1];
type TestTimeout = Parameters<WrappedTestFn>[2];
type TestBodyFn = Extract<NonNullable<TestBody>, UnknownFn>;

type EpicName =
  | 'DOCX Primitives'
  | 'OpenSpec Traceability';

const DEFAULT_EPIC: EpicName = 'DOCX Primitives';
const JSON_CONTENT_TYPE = 'application/json';
const TEXT_CONTENT_TYPE = 'text/plain';

interface AllureLabelDefaults {
  epic?: EpicName;
  feature?: string;
  parentSuite?: string;
  suite?: string;
  subSuite?: string;
  openspecScenarioIds?: string[];
}

function parseCurrentTestName(): string[] {
  const state = expect.getState() as { currentTestName?: string };
  return (state.currentTestName ?? '')
    .split(' > ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveEpic(feature: string, fullName: string, defaults?: AllureLabelDefaults): EpicName {
  void feature;
  void fullName;
  if (defaults?.epic) {
    return defaults.epic;
  }
  return DEFAULT_EPIC;
}

async function applyDefaultAllureLabels(defaults?: AllureLabelDefaults): Promise<void> {
  const allureRuntime = getAllureRuntime();
  if (!allureRuntime) {
    return;
  }

  const nameParts = parseCurrentTestName();
  const hierarchyParts = nameParts.slice(0, -1);
  const fullName = nameParts.join(' > ');
  const feature = defaults?.feature ?? hierarchyParts[0] ?? nameParts[0] ?? 'General';
  const suite = defaults?.suite ?? hierarchyParts[1];
  const subSuite = defaults?.subSuite ?? hierarchyParts[2];
  const epic = resolveEpic(feature, fullName, defaults);
  const parentSuite = defaults?.parentSuite ?? epic;

  await allureRuntime.epic(epic);
  await allureRuntime.feature(feature);
  await allureRuntime.parentSuite(parentSuite);
  if (suite) {
    await allureRuntime.suite(suite);
  }
  if (subSuite && typeof allureRuntime.subSuite === 'function') {
    await allureRuntime.subSuite(subSuite);
  }
  await allureRuntime.severity('normal');
}

function resolveStoryLabel(explicitName: unknown, nameParts: string[]): string {
  if (
    typeof explicitName === 'string'
    && explicitName.trim().length > 0
    && !/%[sdifjoO]/.test(explicitName)
  ) {
    return explicitName;
  }
  return nameParts.at(-1) ?? 'Unnamed test';
}

function normalizeOpenSpecScenarioIds(values: unknown[]): string[] {
  const flattened = values.flatMap((value) => Array.isArray(value) ? value : [value]);
  const ids = flattened
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(ids)];
}

function extractScenarioId(story: string): string | null {
  const match = story.trim().match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

function wrapWithAllure(fn?: TestBody, explicitName?: unknown, defaults?: AllureLabelDefaults): TestBody {
  if (!fn) {
    return fn;
  }

  const run = fn as TestBodyFn;
  return (async (...args: unknown[]) => {
    await applyDefaultAllureLabels(defaults);

    const nameParts = parseCurrentTestName();
    const scenarioIds = defaults?.openspecScenarioIds ?? [];
    const storyLabels: string[] = scenarioIds.length > 0
      ? scenarioIds
      : [resolveStoryLabel(explicitName, nameParts)];

    const allureRuntime = getAllureRuntime();
    if (allureRuntime) {
      const scenarioSerials = new Set<string>();
      for (const story of storyLabels) {
        await allureRuntime.story(story);
        const id = extractScenarioId(story);
        if (id) scenarioSerials.add(id);
      }
      if (scenarioSerials.size === 1 && typeof allureRuntime.id === 'function') {
        await allureRuntime.id([...scenarioSerials][0]);
      }
      if (typeof allureRuntime.label === 'function') {
        for (const id of scenarioSerials) {
          await allureRuntime.label('openspecScenarioId', id);
        }
      }
    }

    try {
      return await run(...args);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await allureAttachment('execution-error.txt', message, TEXT_CONTENT_TYPE);
      throw error;
    }
  }) as TestBody;
}

type WrappedAllureTestFn = WrappedTestFn & {
  withLabels: (defaults: AllureLabelDefaults) => WrappedAllureTestFn;
  epic: (epic: EpicName) => WrappedAllureTestFn;
  openspec: (...scenarioIds: Array<string | string[]>) => WrappedAllureTestFn;
};

function withAllure(base: WrappedTestFn, defaults?: AllureLabelDefaults): WrappedAllureTestFn {
  const wrapped = ((name: TestName, fn?: TestBody, timeout?: TestTimeout) =>
    base(name, wrapWithAllure(fn, name, defaults), timeout)) as WrappedAllureTestFn;

  wrapped.only = (name: TestName, fn?: TestBody, timeout?: TestTimeout) =>
    base.only(name, wrapWithAllure(fn, name, defaults), timeout);
  wrapped.skip = base.skip.bind(base);
  wrapped.todo = base.todo.bind(base);
  wrapped.fails = (name: TestName, fn?: TestBody, timeout?: TestTimeout) =>
    base.fails(name, wrapWithAllure(fn, name, defaults), timeout);
  wrapped.concurrent = (name: TestName, fn?: TestBody, timeout?: TestTimeout) =>
    base.concurrent(name, wrapWithAllure(fn, name, defaults), timeout);

  wrapped.each = (...tableArgs: unknown[]) => {
    const eachBase = (base.each as (...args: unknown[]) => WrappedTestFn)(...tableArgs);
    return (name: TestName, fn?: TestBody, timeout?: TestTimeout) =>
      eachBase(name, wrapWithAllure(fn, name, defaults), timeout);
  };

  wrapped.withLabels = (nextDefaults: AllureLabelDefaults) =>
    withAllure(base, { ...defaults, ...nextDefaults });
  wrapped.epic = (epic: EpicName) =>
    withAllure(base, { ...defaults, epic });
  wrapped.openspec = (...scenarioIds: Array<string | string[]>) =>
    withAllure(base, {
      ...defaults,
      openspecScenarioIds: normalizeOpenSpecScenarioIds(scenarioIds),
    });

  return wrapped;
}

export const itAllure = withAllure(vitestIt);
export const testAllure = withAllure(vitestTest);

export async function allureStep<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const allureRuntime = getAllureRuntime();
  if (allureRuntime) {
    return allureRuntime.step(name, run);
  }
  return run();
}

export async function allureParameter(name: string, value: string): Promise<void> {
  const allureRuntime = getAllureRuntime();
  if (allureRuntime && typeof allureRuntime.parameter === 'function') {
    await allureRuntime.parameter(name, value);
  }
}

export async function allureAttachment(name: string, content: string, contentType = TEXT_CONTENT_TYPE): Promise<void> {
  const allureRuntime = getAllureRuntime();
  if (allureRuntime && typeof allureRuntime.attachment === 'function') {
    await allureRuntime.attachment(name, content, contentType);
  }
}

export async function allureJsonAttachment(name: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload, null, 2);
  await allureAttachment(name, body, JSON_CONTENT_TYPE);
}
