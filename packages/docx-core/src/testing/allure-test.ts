import {
  createAllureTestHelpers,
  type AllureBddContext as SharedAllureBddContext,
  type AllureRuntime as SharedAllureRuntime,
  type AllureStepContext as SharedAllureStepContext,
} from '../../../../testing/allure-test-factory.js';

export { xmlToDocPreviewRuns } from './allure-preview-helpers.js';
export type { DocPreviewRun } from './allure-preview-helpers.js';

type EpicName =
  | 'Document Comparison';

export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;
export type AllureBddContext = SharedAllureBddContext;

const helpers = createAllureTestHelpers<EpicName>({
  defaultEpic: 'Document Comparison',
});

export const {
  itAllure,
  testAllure,
  allureStep,
  allureParameter,
  allureAttachment,
  allureJsonAttachment,
  getAllureRuntime,
} = helpers;
