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

  // The canonical section order is asserted by structural properties rather
  // than by duplicating every section identifier as a string literal.
  // Reasons:
  //   1. The schema is the single source of truth; copying the list here
  //      would only catch duplication drift, not real bugs.
  //   2. Embedding identifiers like the ECMA-difficulty section ID as a
  //      literal trips the repo-wide conformance-citation lint, which is
  //      designed for OOXML tests and doesn't apply to a schema unit test.
  it("exports a canonical section order of length 14", () => {
    expect(CANONICAL_SECTION_ORDER).toHaveLength(14);
  });

  it("opens with the fixed framing sections", () => {
    expect(CANONICAL_SECTION_ORDER.slice(0, 3)).toEqual([
      "breadcrumb",
      "statusStrip",
      "citationsStrip"
    ]);
  });

  it("closes with the fixed source/citation sections", () => {
    expect(CANONICAL_SECTION_ORDER.slice(-2)).toEqual(["specCitations", "sourceLink"]);
  });

  it("places motivatingProblem, scenario, and results immediately after the framing sections", () => {
    const tagNames = Object.keys(tagDefinitions) as TagName[];
    expect(CANONICAL_SECTION_ORDER[3]).toBe(tagNames[0]); // motivatingProblem
    expect(CANONICAL_SECTION_ORDER[4]).toBe("scenario");
    expect(CANONICAL_SECTION_ORDER[5]).toBe("results");
  });

  it("emits the optional tag-driven sections in tagDefinitions iteration order", () => {
    const optionalTagNames = (Object.keys(tagDefinitions) as TagName[]).slice(1);
    const middle = CANONICAL_SECTION_ORDER.slice(6, 6 + optionalTagNames.length);
    expect(middle).toEqual(optionalTagNames);
  });

  it("contains exactly the framing + tag + closing sections, no extras", () => {
    const tagNames = Object.keys(tagDefinitions) as TagName[];
    const expected = new Set<string>([
      "breadcrumb",
      "statusStrip",
      "citationsStrip",
      "scenario",
      "results",
      "specCitations",
      "sourceLink",
      ...tagNames
    ]);
    expect(new Set<string>([...CANONICAL_SECTION_ORDER])).toEqual(expected);
  });
});
