import { posix } from 'node:path';

export type OpcRelationshipTargetMode = 'Internal' | 'External';

export type OpcRelationshipTargetIssue =
  | 'empty_target'
  | 'invalid_target_mode'
  | 'external_target_not_allowed'
  | 'invalid_encoding'
  | 'unsafe_target'
  | 'package_escape'
  | 'empty_resolved_target'
  | 'invalid_external_target';

export class OpcRelationshipTargetError extends Error {
  constructor(
    readonly issue: OpcRelationshipTargetIssue,
    message: string,
  ) {
    super(message);
    this.name = 'OpcRelationshipTargetError';
  }
}

export interface NormalizeOpcRelationshipTargetOptions {
  ownerPart: string;
  target: string;
  targetMode?: string | null;
  allowExternal?: boolean;
}

export interface NormalizedOpcRelationshipTarget {
  mode: OpcRelationshipTargetMode;
  target: string;
}

function targetMode(value: string | null | undefined): OpcRelationshipTargetMode {
  if (value === null || value === undefined || value === 'Internal') {
    return 'Internal';
  }
  if (value === 'External') return 'External';
  throw new OpcRelationshipTargetError(
    'invalid_target_mode',
    `invalid relationship TargetMode '${value}'`,
  );
}

function normalizeInternalTarget(ownerPart: string, target: string): string {
  if (!target) {
    throw new OpcRelationshipTargetError('empty_target', 'empty internal relationship target');
  }
  if (target.includes('\\') || /[\u0000-\u001f\u007f?#]/u.test(target)) {
    throw new OpcRelationshipTargetError(
      'unsafe_target',
      `unsafe internal relationship target '${target}'`,
    );
  }
  let decoded = target;
  for (let pass = 0; pass <= target.length; pass++) {
    if (/%(?:2f|5c)/iu.test(decoded)) {
      throw new OpcRelationshipTargetError(
        'unsafe_target',
        `encoded path separator in internal relationship target '${target}'`,
      );
    }
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new OpcRelationshipTargetError(
        'invalid_encoding',
        `invalid encoded relationship target '${target}'`,
      );
    }
    const rawSegments = decoded.split('/');
    const nextSegments = next.split('/');
    if (
      next.includes('\\') ||
      /[\u0000-\u001f\u007f?#]/u.test(next) ||
      next.startsWith('//') ||
      next.includes(':') ||
      nextSegments.some((segment, index) =>
        (segment === '.' || segment === '..') && rawSegments[index] !== segment
      )
    ) {
      throw new OpcRelationshipTargetError(
        'unsafe_target',
        `unsafe internal relationship target '${target}'`,
      );
    }
    decoded = next;
    if (!/%[0-9a-f]{2}/iu.test(decoded)) break;
    if (pass === target.length) {
      throw new OpcRelationshipTargetError(
        'invalid_encoding',
        `excessively nested encoded relationship target '${target}'`,
      );
    }
  }
  const decodedSegments = decoded.split('/');

  const segments = decoded.startsWith('/')
    ? []
    : posix.dirname(ownerPart).split('/').filter(Boolean);
  for (const segment of decodedSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new OpcRelationshipTargetError(
          'package_escape',
          `relationship target escapes the package root: '${target}'`,
        );
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (segments.length === 0) {
    throw new OpcRelationshipTargetError(
      'empty_resolved_target',
      `empty resolved relationship target '${target}'`,
    );
  }
  return segments.join('/');
}

/**
 * Normalize one OPC relationship target under SafeDocX package-containment
 * policy. Internal targets are decoded once, checked for ambiguous or unsafe
 * URI/path forms, and resolved relative to the owning part. External targets
 * are accepted only when the caller opts in.
 */
export function normalizeOpcRelationshipTarget(
  options: NormalizeOpcRelationshipTargetOptions,
): NormalizedOpcRelationshipTarget {
  const mode = targetMode(options.targetMode);
  if (mode === 'External') {
    if (!options.allowExternal) {
      throw new OpcRelationshipTargetError(
        'external_target_not_allowed',
        `external relationship target is not allowed: '${options.target}'`,
      );
    }
    try {
      return { mode, target: new URL(options.target).href };
    } catch {
      throw new OpcRelationshipTargetError(
        'invalid_external_target',
        `unsafe external relationship target '${options.target}'`,
      );
    }
  }
  return {
    mode,
    target: normalizeInternalTarget(options.ownerPart, options.target),
  };
}
