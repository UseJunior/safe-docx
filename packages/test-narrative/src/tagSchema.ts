import { z } from "zod";

export type TagDefinition = {
  required: boolean;
  minWords: number;
  maxWords: number;
  sectionId: string;
  sectionTitle: string;
};

export const tagDefinitions = {
  motivatingProblem: {
    required: true,
    minWords: 60,
    maxWords: 150,
    sectionId: "motivatingProblem",
    sectionTitle: "Motivating problem"
  },
  implementationLimitation: {
    required: false,
    minWords: 40,
    maxWords: 300,
    sectionId: "implementationLimitation",
    sectionTitle: "Implementation limitations"
  },
  testScopeExclusion: {
    required: false,
    minWords: 40,
    maxWords: 300,
    sectionId: "testScopeExclusion",
    sectionTitle: "Test-scope exclusions"
  },
  observedPerformance: {
    required: false,
    minWords: 40,
    maxWords: 200,
    sectionId: "observedPerformance",
    sectionTitle: "Observed performance characteristics"
  },
  potentialMisconception: {
    required: false,
    minWords: 40,
    maxWords: 250,
    sectionId: "potentialMisconception",
    sectionTitle: "Potential misconceptions"
  },
  implementationAlternativeRejected: {
    required: false,
    minWords: 40,
    maxWords: 250,
    sectionId: "implementationAlternativeRejected",
    sectionTitle: "Implementation alternatives considered and rejected"
  },
  ecma376Difficulty: {
    required: false,
    minWords: 40,
    maxWords: 250,
    sectionId: "ecma376Difficulty",
    sectionTitle: "What makes this hard in ECMA-376"
  }
} as const satisfies Record<string, TagDefinition>;

export type TagName = keyof typeof tagDefinitions;

// Cross-implementation suite join keys. Authored as a `@suiteScenarioIds`
// JSDoc tag (comma/whitespace-separated list), these are renderer-facing join
// keys between a corpus entry and the cross-impl suite repo's results JSON.
// They are NOT prose, so they live outside `tagDefinitions` (no word counts)
// and outside the entry `narrative` object.
export const SUITE_SCENARIO_IDS_TAG = "suiteScenarioIds";

export const suiteScenarioIdsSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "suiteScenarioIds must not contain duplicates"
  });

export type SuiteScenarioIds = z.infer<typeof suiteScenarioIdsSchema>;

export const rejectedAliases = [
  "limitation",
  "aiContext",
  "compare",
  "specQuirk",
  "notCovered",
  "prose",
  "description",
  "discussion"
] as const;

export const CANONICAL_SECTION_ORDER = [
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
  "ecma376Difficulty",
  "specCitations",
  "sourceLink"
] as const;

const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

const tagValueSchema = (tagName: TagName, definition: TagDefinition): z.ZodString =>
  z.string().refine(
    (value) => {
      const wordCount = countWords(value);
      return wordCount >= definition.minWords && wordCount <= definition.maxWords;
    },
    {
      message: `${tagName} must contain ${definition.minWords}-${definition.maxWords} words`
    }
  );

const tagShape = Object.fromEntries(
  Object.entries(tagDefinitions).map(([tagName, definition]) => [
    tagName,
    tagValueSchema(tagName as TagName, definition).optional()
  ])
) as { [Name in TagName]: z.ZodOptional<z.ZodString> };

export const tagSchema = z.object(tagShape).strict();

export type NarrativeTags = z.infer<typeof tagSchema>;
export type NarrativeVisibility = "public" | "internal";
export type ValidateTagsResult = ReturnType<typeof tagSchema.safeParse>;

export const validateTags = (
  tags: unknown,
  options: { visibility?: NarrativeVisibility }
): ValidateTagsResult => {
  const parsed = tagSchema.safeParse(tags);
  if (!parsed.success) {
    return parsed;
  }

  if (options.visibility === "public" && parsed.data.motivatingProblem === undefined) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: ["motivatingProblem"],
          message: "motivatingProblem is required when visibility is public"
        }
      ]) as z.ZodError<NarrativeTags>
    };
  }

  return parsed;
};
