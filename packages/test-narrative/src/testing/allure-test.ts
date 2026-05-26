import { createAllureTestHelpers } from "../../../../testing/allure-test-factory.js";

const helpers = createAllureTestHelpers({
  defaultEpic: "Test Infrastructure"
});

export const { itAllure, testAllure } = helpers;
