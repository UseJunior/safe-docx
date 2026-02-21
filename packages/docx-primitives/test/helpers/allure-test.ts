import {
  createAllureTestHelpers,
  type AllureRuntime as SharedAllureRuntime,
  type AllureStepContext as SharedAllureStepContext,
} from '../../../../testing/allure-test-factory.js';

type EpicName =
  | 'DOCX Primitives'
  | 'OpenSpec Traceability';

export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;

const helpers = createAllureTestHelpers<EpicName>({
  defaultEpic: 'DOCX Primitives',
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
