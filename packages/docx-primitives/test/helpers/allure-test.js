import {
  createAllureTestHelpers
} from "../../../../testing/allure-test-factory.js";
const helpers = createAllureTestHelpers({
  defaultEpic: "DOCX Primitives"
});
const {
  itAllure,
  testAllure,
  allureStep,
  allureParameter,
  allureAttachment,
  allureJsonAttachment,
  getAllureRuntime
} = helpers;
export {
  allureAttachment,
  allureJsonAttachment,
  allureParameter,
  allureStep,
  getAllureRuntime,
  itAllure,
  testAllure
};
//# sourceMappingURL=allure-test.js.map
