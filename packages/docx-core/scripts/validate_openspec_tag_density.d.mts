/** Per-test finding emitted by the openspec tag-density detector. */
export interface TagDensityFinding {
  /** 1-based line of the `test(...)` call. */
  line: number;
  /** Number of `.openspec(...)` tags chained onto the test. */
  tagCount: number;
  /** The test's name (first string argument), or `<unnamed test>`. */
  label: string;
  /** True when an adjacent `coverage-rationale` annotation with prose is present. */
  hasRationale: boolean;
  /** True when the annotation marker exists but carries no rationale prose. */
  emptyRationale: boolean;
}

/**
 * Parse a `.test.ts` source string and return every test that carries
 * `>= threshold` `.openspec(...)` tags, flagged with whether it declares a
 * `coverage-rationale` annotation.
 */
export function analyzeFile(
  absPath: string,
  content: string,
  threshold?: number,
): TagDensityFinding[];
