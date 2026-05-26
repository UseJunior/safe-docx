import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect } from "vitest";

import { extractScenarios } from "./astExtractor.js";
import { itAllure as it } from "./testing/allure-test.js";

let tempDirs: string[] = [];

const writeFixture = (source: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-docx-ast-extractor-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "fixture.test.ts");
  fs.writeFileSync(filePath, source);
  return filePath;
};

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("extractScenarios", () => {
  it("extracts a simple openspec scenario with narrative, BDD steps, fixtures, and expect args", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching", visibility: "public" });

      describe("suite", () => {
        /**
         * @motivatingProblem ${words(60)}
         */
        test.openspec("literal substring")("Scenario: literal substring", async ({ given, when, then }) => {
          const haystack = "The Purchase Price shall be paid at Closing.";
          await given("paragraph text contains the needle", async () => {});
          await when("matching runs", async () => {});
          await then("status is unique", () => {
            expect(haystack).toContain("Purchase Price");
          });
        });
      });
    `);

    const scenarios = extractScenarios(filePath);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({
      scenarioName: "Scenario: literal substring",
      visibility: "public",
      narrative: { motivatingProblem: words(60) }
    });
    expect(scenarios[0]?.bddSteps.map((step) => step.keyword)).toEqual(["given", "when", "then"]);
    expect(scenarios[0]?.bddSteps[0]?.value).toEqual({
      kind: "literal",
      value: "paragraph text contains the needle"
    });
    expect(scenarios[0]?.fixtures).toContainEqual(
      expect.objectContaining({
        name: "haystack",
        value: { kind: "literal", value: "The Purchase Price shall be paid at Closing." }
      })
    );
    expect(scenarios[0]?.expectArgs[0]).toMatchObject({
      sourceText: "haystack",
      value: { kind: "literal", value: "The Purchase Price shall be paid at Closing." }
    });
  });

  it("treats imported fixture arguments as unresolved evidence", () => {
    const filePath = writeFixture(`
      import { SHARED_PARAGRAPH_FIXTURE } from "./fixtures.js";
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("fixture")("Scenario: imported fixture", async ({ given }) => {
        await given(SHARED_PARAGRAPH_FIXTURE, async () => {});
      });
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.bddSteps[0]?.value).toMatchObject({
      kind: "unresolved",
      sourceText: "SHARED_PARAGRAPH_FIXTURE"
    });
  });

  it("treats factory-call expect arguments as unresolved evidence", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("factory")("Scenario: factory call", async () => {
        expect(buildFixture("case-A")).toEqual({});
      });
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.expectArgs[0]).toMatchObject({
      sourceText: 'buildFixture("case-A")',
      value: { kind: "unresolved", sourceText: 'buildFixture("case-A")' }
    });
  });

  it("treats template literals with runtime expressions as unresolved evidence", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("template")("Scenario: runtime template", async ({ given }) => {
        const name = "closing";
        await given(\`paragraph mentions \${name}\`, async () => {});
      });
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.bddSteps[0]?.value).toMatchObject({
      kind: "unresolved",
      sourceText: "`paragraph mentions ${name}`"
    });
  });

  it("resolves expression-free template literals as literal evidence", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("template")("Scenario: static template", async ({ given }) => {
        await given(\`paragraph mentions closing\`, async () => {});
      });
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.bddSteps[0]?.value).toEqual({
      kind: "literal",
      value: "paragraph mentions closing"
    });
  });

  it("returns an empty narrative object when no leading JSDoc exists", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("no docs")("Scenario: no docs", async () => {});
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.narrative).toEqual({});
  });

  it("preserves rejected aliases in narrative output for schema validation", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      /**
       * @limitation ${words(40)}
       * @motivatingProblem ${words(60)}
       */
      test.openspec("alias")("Scenario: rejected alias", async () => {});
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.narrative).toEqual({
      limitation: words(40),
      motivatingProblem: words(60)
    });
  });

  it("extracts multiple scenarios from one file", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("one")("Scenario: one", async () => {});
      test.openspec("two")("Scenario: two", async () => {});
    `);

    expect(extractScenarios(filePath).map((scenario) => scenario.scenarioName)).toEqual([
      "Scenario: one",
      "Scenario: two"
    ]);
  });

  it("extracts visibility from an allure chain before openspec", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.allure({ visibility: "public" }).openspec("public")("Scenario: public", async () => {});
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.visibility).toBe("public");
  });

  it("extracts visibility through a local human-readable test variable", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });
      const humanReadableTest = test.allure({ story: "Story", visibility: "public" });

      humanReadableTest.openspec("public")("Scenario: public variable", async () => {});
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.visibility).toBe("public");
  });

  it("extracts visibility from a metadata call after openspec", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("public")({ visibility: "public" })("Scenario: public metadata", async () => {});
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.visibility).toBe("public");
  });

  it("extracts the testAllure.openspec call shape", () => {
    const filePath = writeFixture(`
      testAllure.openspec("direct")("Scenario: direct", async ({ then }) => {
        await then("the direct shape is accepted", () => {});
      });
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.scenarioName).toBe("Scenario: direct");
    expect(scenario?.bddSteps[0]?.value).toEqual({
      kind: "literal",
      value: "the direct shape is accepted"
    });
  });

  it("records non-literal local fixtures as unresolved instead of evaluating them", () => {
    const filePath = writeFixture(`
      const test = testAllure.epic("DOCX Primitives").withLabels({ feature: "Text Matching" });

      test.openspec("local factory")("Scenario: local factory", async () => {
        const fixture = buildFixture("case-A");
        expect(fixture).toEqual({});
      });
    `);

    const [scenario] = extractScenarios(filePath);

    expect(scenario?.fixtures).toContainEqual(
      expect.objectContaining({
        name: "fixture",
        value: expect.objectContaining({ kind: "unresolved", sourceText: 'buildFixture("case-A")' })
      })
    );
    expect(scenario?.expectArgs[0]?.value).toMatchObject({
      kind: "unresolved",
      sourceText: "fixture"
    });
  });
});
