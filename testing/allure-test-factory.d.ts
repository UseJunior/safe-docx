import type { it as vitestIt } from 'vitest';

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
  description?(value: string): void | Promise<void>;
  tags?(...values: string[]): void | Promise<void>;
  tag?(value: string): void | Promise<void>;
  step<T>(name: string, body: AllureStepBody<T>): Promise<T>;
  parameter?(name: string, value: string): void | Promise<void>;
  attachment?(name: string, content: string, contentType?: string): void | Promise<void>;
};

export type WrappedTestFn = typeof vitestIt;
export type TestName = Parameters<WrappedTestFn>[0];
export type TestBody = Parameters<WrappedTestFn>[1];
export type TestTimeout = Parameters<WrappedTestFn>[2];

export interface AllureLabelDefaults<TEpic extends string = string> {
  epic?: TEpic;
  feature?: string;
  parentSuite?: string;
  suite?: string;
  subSuite?: string;
  openspecScenarioIds?: string[];
  description?: string;
  tags?: string[];
  parameters?: Record<string, string | number | boolean>;
}

export type AllureMetadata = Pick<AllureLabelDefaults, 'description' | 'tags' | 'parameters'>;

export type WrappedAllureTestFn<TEpic extends string = string> = WrappedTestFn & {
  withLabels: (defaults: AllureLabelDefaults<TEpic>) => WrappedAllureTestFn<TEpic>;
  epic: (epic: TEpic) => WrappedAllureTestFn<TEpic>;
  openspec: (...scenarioIds: Array<string | string[]>) => WrappedAllureTestFn<TEpic>;
  allure: (metadata: AllureMetadata) => WrappedAllureTestFn<TEpic>;
};

export type AllureTestHelpers<TEpic extends string = string> = {
  itAllure: WrappedAllureTestFn<TEpic>;
  testAllure: WrappedAllureTestFn<TEpic>;
  allureStep: <T>(name: string, run: () => T | Promise<T>) => Promise<T>;
  allureParameter: (name: string, value: string) => Promise<void>;
  allureAttachment: (name: string, content: string, contentType?: string) => Promise<void>;
  allureJsonAttachment: (name: string, payload: unknown) => Promise<void>;
  getAllureRuntime: () => AllureRuntime | undefined;
};

export function getAllureRuntime(): AllureRuntime | undefined;

export function createAllureTestHelpers<TEpic extends string>(config: {
  defaultEpic: TEpic;
  resolveEpic?: (
    feature: string,
    fullName: string,
    defaults?: AllureLabelDefaults<TEpic>,
  ) => TEpic;
}): AllureTestHelpers<TEpic>;
