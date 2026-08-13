export const RELEASE_MANIFEST_VERSION = 1 as const;
export const RELEASE_CERTIFICATE_VERSION = 1 as const;

export type VerdictStatus = 'pass' | 'fail' | 'not_run';
export type GateName = 'semantic' | 'minimality' | 'package' | 'comments' | 'expectations' | 'mutationControl' | 'renderer' | 'humanReview';

export interface Verdict {
  status: VerdictStatus;
  required: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface TextExpectation {
  text: string;
  count: number;
  projection?: 'accept' | 'reject';
}

export interface MutationControl {
  projection: 'accept' | 'reject';
  expected: 'original' | 'intendedClean';
  /** Character index to change; defaults to the first non-empty character. */
  index?: number;
}

export interface LeanCheckerConfig {
  command?: string;
  args?: string[];
  required?: boolean;
  timeoutMs?: number;
}

export interface ReleaseManifest {
  version: typeof RELEASE_MANIFEST_VERSION;
  originalPath: string;
  intendedCleanPath: string;
  trackedPath: string;
  expectedHashes?: Partial<Record<'original' | 'intendedClean' | 'tracked', string>>;
  literalCounts?: TextExpectation[];
  presentOnlyInAccept?: string[];
  absentFromAccept?: string[];
  requireNativeComments?: boolean;
  mutationControl?: MutationControl;
  lean?: LeanCheckerConfig;
  requireRenderer?: boolean;
  /** JSON verdict emitted independently by docx-render-verifier. */
  rendererEvidencePath?: string;
  humanReview?: { reviewer: string; reviewedAt: string; approved: boolean };
}

export interface Projection {
  paragraphs: string[];
  text: string;
}

export interface ReleaseCertificate {
  version: typeof RELEASE_CERTIFICATE_VERSION;
  manifestVersion: number;
  hashes: Record<'original' | 'intendedClean' | 'tracked', string>;
  projections: { original: Projection; intendedClean: Projection; accept: Projection; reject: Projection };
  gates: Record<GateName, Verdict>;
  delivery: Verdict;
  exitCode: 0 | 1 | 3;
}
