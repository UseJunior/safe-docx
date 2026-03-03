/**
 * Quality benchmark type definitions.
 *
 * Gate-then-score architecture: hard gates must pass before scores are computed.
 */

export type BenchmarkEngine = 'atomizer' | 'diffmatch' | 'aspose';

// ── Gate results ────────────────────────────────────────────────────

export interface G1TextRoundTripResult {
  normalizedTextParity: { passed: boolean; detail: string };  // G1a
  paragraphCountParity: { passed: boolean; detail: string };  // G1b
  xmlParseValidity: { passed: boolean; detail: string };      // G1c
}

export interface GateResult {
  passed: boolean;
  detail: string;
}

export interface GateResults {
  textRoundTrip: G1TextRoundTripResult;   // G1 — HARD (all sub-gates must pass)
  formattingProjection: GateResult;        // G2 — SOFT (diagnostic only in v1)
  structuralIntegrity: GateResult;         // G3 — HARD
}

// ── Score results ───────────────────────────────────────────────────

export interface ScoreResults {
  diffMinimality: {
    engineRuns: number;
    oracleRuns: number | null;
    ratio: number | null;
  } | null;
  compatibility: {
    opensClean: boolean;
    skipReason?: string;
  } | null;
  performance: { wallTimeMs: number };
  extras: {
    moveDetection: boolean;
    tableCellDiff: boolean;
  };
}

// ── Engine result ───────────────────────────────────────────────────

export interface EngineResult {
  engine: BenchmarkEngine;
  gates: GateResults;
  hardGatesPassed: boolean;   // G1 (all sub-gates) + G3
  softGatesPassed: boolean;   // G2 (informational)
  scores: ScoreResults | null;
  error?: string;
}

// ── Fixture result ──────────────────────────────────────────────────

export interface FixtureBenchmarkResult {
  fixture: string;
  tags: string[];
  engines: Record<string, EngineResult>;
  timestamp: string;
}

// ── Manifest schema ─────────────────────────────────────────────────

export interface FixtureManifestEntry {
  name: string;
  original: string;  // relative to manifest dir + base_dir
  revised: string;    // relative to manifest dir + base_dir
  tags: string[];
  oracleRedline?: string;
}

export interface FixtureManifest {
  base_dir: string;  // resolved relative to manifest file location
  fixtures: FixtureManifestEntry[];
}

// ── Config ──────────────────────────────────────────────────────────

export interface QualityBenchmarkConfig {
  manifestPath: string;
  engines: BenchmarkEngine[];
  author?: string;
  asposeCliPath?: string;
  libreOfficePath?: string;
  timeout?: number;
}
