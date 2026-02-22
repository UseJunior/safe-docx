import {
  createAllureTestHelpers,
  type AllureBddContext as SharedAllureBddContext,
  type AllureRuntime as SharedAllureRuntime,
  type AllureStepContext as SharedAllureStepContext,
} from '../../../../testing/allure-test-factory.js';

type EpicName =
  | 'Safe DOCX MCP Bundle'
  | 'OpenSpec Traceability';

export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;
export type AllureBddContext = SharedAllureBddContext;

const helpers = createAllureTestHelpers<EpicName>({
  defaultEpic: 'Safe DOCX MCP Bundle',
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
