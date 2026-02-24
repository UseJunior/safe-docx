/**
 * Benchmark metrics collection.
 *
 * Defines the metrics collected during A/B baseline comparison.
 */

/**
 * Metrics collected from a comparison operation.
 */
export interface ComparisonMetrics {
  // Op-level metrics
  /** Number of insertions detected */
  insertions: number;
  /** Number of deletions detected */
  deletions: number;
  /** Number of modifications (paragraphs with changes) */
  modifications: number;
  /** Average length of changed spans */
  avgSpanLength: number;

  // Structural validity
  /** Whether output opens in Word (requires manual verification or COM automation) */
  opensInWord: boolean | null;
  /** Whether OpenXML SDK can load the output */
  openXmlSdkValid: boolean | null;
  /** Whether all relationship parts are valid */
  noBrokenRelationships: boolean | null;

  // Contract-specific (requires domain knowledge to verify)
  /** Whether numbering was retained correctly */
  numberingRetained: boolean | null;
  /** Whether section headings are correct */
  sectionHeadingsCorrect: boolean | null;
  /** Whether defined terms are preserved */
  definedTermsPreserved: boolean | null;
  /** Whether tables remain intact */
  tablesIntact: boolean | null;
  /** Whether cross-references work */
  crossRefsWorking: boolean | null;

  // Performance
  /** Wall clock time in milliseconds */
  wallTimeMs: number;
  /** Peak RSS memory in megabytes */
  peakRssMb: number;
  /** Output file size in bytes */
  outputSizeBytes: number;
}

/**
 * Create an empty metrics object with null values.
 */
export function createEmptyMetrics(): ComparisonMetrics {
  return {
    insertions: 0,
    deletions: 0,
    modifications: 0,
    avgSpanLength: 0,
    opensInWord: null,
    openXmlSdkValid: null,
    noBrokenRelationships: null,
    numberingRetained: null,
    sectionHeadingsCorrect: null,
    definedTermsPreserved: null,
    tablesIntact: null,
    crossRefsWorking: null,
    wallTimeMs: 0,
    peakRssMb: 0,
    outputSizeBytes: 0,
  };
}

/**
 * Result of running a benchmark on a fixture.
 */
export interface BenchmarkResult {
  /** Name of the fixture */
  fixture: string;
  /** Metrics from Baseline A (WmlComparer) */
  baselineA: ComparisonMetrics | null;
  /** Error from Baseline A if any */
  baselineAError?: string;
  /** Metrics from Baseline B (pure TS) */
  baselineB: ComparisonMetrics | null;
  /** Error from Baseline B if any */
  baselineBError?: string;
  /** Metrics from Word oracle (if available) */
  wordOracle?: ComparisonMetrics | null;
  /** Timestamp when benchmark was run */
  timestamp: Date;
}

/**
 * Measure memory usage.
 */
export function measureMemory(): number {
  const usage = process.memoryUsage();
  return usage.rss / (1024 * 1024); // Convert to MB
}

/**
 * High-resolution timer for performance measurement.
 */
export function createTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000; // Convert to ms
  };
}
