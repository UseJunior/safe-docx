import {
  createAllureTestHelpers,
  type AllureBddContext as SharedAllureBddContext,
  type AllureRuntime as SharedAllureRuntime,
  type AllureStepContext as SharedAllureStepContext,
} from '../../../../testing/allure-test-factory.js';

type EpicName =
  | 'Document Editing'
  | 'Session Management'
  | 'Document Reading'
  | 'Download & Export'
  | 'Matching Engine'
  | 'OpenSpec Traceability';

export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;
export type AllureBddContext = SharedAllureBddContext;

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
