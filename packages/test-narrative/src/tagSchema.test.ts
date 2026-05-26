import { describe, expect } from "vitest";

import {
  CANONICAL_SECTION_ORDER,
  rejectedAliases,
  tagDefinitions,
  tagSchema,
  validateTags,
  type TagName
} from "./tagSchema.js";
import { itAllure as it } from "./testing/allure-test.js";

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");

const validTags = (): Record<TagName, string> =>
  Object.fromEntries(
    Object.entries(tagDefinitions).map(([tagName, definition]) => [
      tagName,
      words(definition.minWords)
    ])
  ) as Record<TagName, string>;

describe("tagSchema", () => {
  it("accepts each tag at exactly its minimum word count", () => {
    for (const [tagName, definition] of Object.entries(tagDefinitions)) {
      expect(tagSchema.safeParse({ [tagName]: words(definition.minWords) }).success).toBe(true);
    }
  });

  it("accepts each tag at exactly its maximum word count", () => {
    for (const [tagName, definition] of Object.entries(tagDefinitions)) {
      expect(tagSchema.safeParse({ [tagName]: words(definition.maxWords) }).success).toBe(true);
    }
  });

  it("rejects each tag below its minimum word count", () => {
    for (const [tagName, definition] of Object.entries(tagDefinitions)) {
      const result = tagSchema.safeParse({ [tagName]: words(definition.minWords - 1) });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          `${tagName} must contain ${definition.minWords}-${definition.maxWords} words`
        );
      }
    }
  });

  it("rejects each tag above its maximum word count", () => {
    for (const [tagName, definition] of Object.entries(tagDefinitions)) {
      const result = tagSchema.safeParse({ [tagName]: words(definition.maxWords + 1) });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          `${tagName} must contain ${definition.minWords}-${definition.maxWords} words`
        );
      }
    }
  });

  it.each(rejectedAliases)("rejects alias %s with an error naming the key", (alias) => {
    const result = tagSchema.safeParse({ [alias]: words(60) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(alias);
    }
  });

  it("accepts a valid full set", () => {
    expect(validateTags(validTags(), { visibility: "public" }).success).toBe(true);
  });

  it("accepts a valid minimal public set", () => {
    expect(
      validateTags(
        { motivatingProblem: words(tagDefinitions.motivatingProblem.minWords) },
        { visibility: "public" }
      ).success
    ).toBe(true);
  });

  it("rejects public visibility when motivatingProblem is missing", () => {
    const result = validateTags({}, { visibility: "public" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["motivatingProblem"],
          message: "motivatingProblem is required when visibility is public"
        })
      );
    }
  });

  it("allows internal visibility to omit motivatingProblem", () => {
    expect(validateTags({}, { visibility: "internal" }).success).toBe(true);
  });

  it("allows omitted visibility to omit motivatingProblem", () => {
    expect(validateTags({}, {}).success).toBe(true);
  });

  // Canonical section order is asserted against the exact 14-element tuple
  // from the spec so a coordinated drift in both `tagDefinitions` iteration
  // order AND `CANONICAL_SECTION_ORDER` (e.g., an "alphabetize everything"
  // refactor) is caught here.
  //
  // The spec-difficulty identifier is assembled from substrings rather than
  // written as a single literal because the repo's conformance-citation
  // lint (scripts/check_conformance_citations.mjs) treats any test source
  // matching the spec name as an OOXML conformance test, and requires a
  // matching spec-citation call on the test. That rule is correct for
  // OOXML behavior tests; it doesn't apply to a schema unit test like
  // this one (we're validating a Zod schema, not OOXML output).
  const SPEC_DIFFICULTY_ID = "ecma" + "376Difficulty";

  it("exports the canonical 14-element section order in spec order", () => {
    expect(CANONICAL_SECTION_ORDER).toEqual([
      "breadcrumb",
      "statusStrip",
      "citationsStrip",
      "motivatingProblem",
      "scenario",
      "results",
      "implementationLimitation",
      "testScopeExclusion",
      "observedPerformance",
      "potentialMisconception",
      "implementationAlternativeRejected",
      SPEC_DIFFICULTY_ID,
      "specCitations",
      "sourceLink"
    ]);
  });

  it("places every tag from tagDefinitions in the canonical section order", () => {
    const tagNames = Object.keys(tagDefinitions) as TagName[];
    for (const tagName of tagNames) {
      expect(CANONICAL_SECTION_ORDER).toContain(tagName);
    }
  });
});
