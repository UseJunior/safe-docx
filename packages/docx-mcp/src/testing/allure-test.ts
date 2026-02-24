import {
  createAllureTestHelpers,
  type AllureBddContext as SharedAllureBddContext,
  type AllureRuntime as SharedAllureRuntime,
  type AllureStepContext as SharedAllureStepContext,
  type DocPreviewOptions as SharedDocPreviewOptions,
  type DocPreviewRun as SharedDocPreviewRun,
  type DocPreviewFootnote as SharedDocPreviewFootnote,
} from '../../../../testing/allure-test-factory.js';

type EpicName =
  | 'Document Editing'
  | 'Document Comparison'
  | 'Document Reading'
  | 'Test Infrastructure';

export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;
export type AllureBddContext = SharedAllureBddContext;
export type DocPreviewOptions = SharedDocPreviewOptions;
export type DocPreviewRun = SharedDocPreviewRun;
export type DocPreviewFootnote = SharedDocPreviewFootnote;

const helpers = createAllureTestHelpers<EpicName>({
  defaultEpic: 'Document Editing',
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
