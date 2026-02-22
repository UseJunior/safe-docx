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
  allureId?(id: string): void | Promise<void>;
  displayName?(value: string): void | Promise<void>;
  label?(name: string, value: string): void | Promise<void>;
  description?(value: string): void | Promise<void>;
  tags?(...values: string[]): void | Promise<void>;
  tag?(value: string): void | Promise<void>;
  step<T>(name: string, body: AllureStepBody<T>): Promise<T>;
  parameter?(name: string, value: string): void | Promise<void>;
  attachment?(name: string, content: string | Uint8Array, contentType?: string): void | Promise<void>;
};

export type WrappedTestFn = typeof vitestIt;
export type TestName = Parameters<WrappedTestFn>[0];
export type TestBody = Parameters<WrappedTestFn>[1];
export type TestTimeout = Parameters<WrappedTestFn>[2];

export interface AllureLabelDefaults<TEpic extends string = string> {
  id?: string;
  title?: string;
  epic?: TEpic;
  feature?: string;
  parentSuite?: string;
  suite?: string;
  subSuite?: string;
  severity?: string;
  openspecScenarioIds?: string[];
  description?: string;
  tags?: string[];
  parameters?: Record<string, string | number | boolean | null | undefined>;
}

export type AllureMetadata<TEpic extends string = string> = Partial<AllureLabelDefaults<TEpic>>;

export type AllureStepParams = Record<string, string | number | boolean | null | undefined>;

export type AllureBddStep = <T>(
  name: string,
  run: () => T | Promise<T>,
  params?: AllureStepParams,
) => Promise<T>;

export type AllureWordLikePreview = {
  baseText: string;
  insertedText?: string;
  deletedText?: string;
  insertedAuthor?: string;
  deletedAuthor?: string;
};

export type AllureXmlPreviewOptions = {
  xmlName?: string;
  wordLikeName?: string;
  wordLike?: AllureWordLikePreview;
};

export type AllureBddContext = {
  given: AllureBddStep;
  when: AllureBddStep;
  then: AllureBddStep;
  and: AllureBddStep;
  attach: (name: string, content: string | Uint8Array, contentType?: string) => Promise<void>;
  attachText: (name: string, text: string) => Promise<void>;
  attachHtml: (name: string, html: string) => Promise<void>;
  attachMarkdown: (name: string, markdown: string) => Promise<void>;
  attachJson: (name: string, payload: unknown) => Promise<void>;
  attachPrettyXml: (name: string, xml: string) => Promise<void>;
  attachWordLikePreview: (name: string, preview: AllureWordLikePreview) => Promise<void>;
  attachXmlPreviews: (xml: string, options?: AllureXmlPreviewOptions) => Promise<void>;
  setDebugContext: (payload: unknown) => void;
  setDebugResult: (payload: unknown) => void;
  attachJsonLastStep: (options?: {
    context?: unknown;
    result?: unknown;
    contextAttachmentName?: string;
    resultAttachmentName?: string;
    stepName?: string;
  }) => Promise<void>;
  parameter: (name: string, value: string | number | boolean | null | undefined) => Promise<void>;
};

export type WrappedAllureTestFn<TEpic extends string = string> = WrappedTestFn & {
  withLabels: (defaults: AllureLabelDefaults<TEpic>) => WrappedAllureTestFn<TEpic>;
  epic: (epic: TEpic) => WrappedAllureTestFn<TEpic>;
  openspec: (...scenarioIds: Array<string | string[]>) => WrappedAllureTestFn<TEpic>;
  allure: (metadata: AllureMetadata<TEpic>) => WrappedAllureTestFn<TEpic>;
};

export type AllureTestHelpers<TEpic extends string = string> = {
  itAllure: WrappedAllureTestFn<TEpic>;
  testAllure: WrappedAllureTestFn<TEpic>;
  allureStep: <T>(name: string, run: () => T | Promise<T>) => Promise<T>;
  allureParameter: (name: string, value: string) => Promise<void>;
  allureAttachment: (name: string, content: string | Uint8Array, contentType?: string) => Promise<void>;
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
