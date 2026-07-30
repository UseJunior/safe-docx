export type WordFieldKind =
  | 'PAGE'
  | 'NUMPAGES'
  | 'REF'
  | 'PAGEREF'
  | 'TOC'
  | 'SEQ'
  | 'UNKNOWN';

export type FieldEvaluationClass =
  | 'deterministic-ref'
  | 'layout-dependent'
  | 'recognized-unsupported'
  | 'unknown';

export interface FieldInstructionClassification {
  kind: WordFieldKind;
  evaluationClass: FieldEvaluationClass;
  normalizedInstruction: string;
  target?: string;
  switches: string[];
  unsupportedSwitches: string[];
  preservationSupported: boolean;
  reason?: string;
}

interface InstructionToken {
  value: string;
  quoted: boolean;
}

function tokenizeFieldInstruction(instructionText: string): InstructionToken[] | null {
  const tokens: InstructionToken[] = [];
  let value = '';
  let quoted = false;
  let tokenQuoted = false;
  let quoteClosed = false;

  const push = (): void => {
    if (value.length > 0 || tokenQuoted) {
      tokens.push({ value, quoted: tokenQuoted });
      value = '';
      tokenQuoted = false;
      quoteClosed = false;
    }
  };

  for (let index = 0; index < instructionText.length; index += 1) {
    const character = instructionText[index]!;
    if (character === '"') {
      if (!quoted && value.length > 0) return null;
      quoted = !quoted;
      tokenQuoted = true;
      quoteClosed = !quoted;
    } else if (/\s/u.test(character) && !quoted) {
      push();
    } else {
      if (quoteClosed) return null;
      value += character;
    }
  }
  if (quoted) return null;
  push();
  return tokens;
}

function normalizeTokens(tokens: InstructionToken[]): string {
  return tokens
    .map(({ value, quoted }) =>
      quoted || /\s/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value,
    )
    .join(' ');
}

/**
 * Classify the Word field instruction subset understood by Safe Docx.
 *
 * This parser is intentionally switch-aware: recognizing the leading keyword
 * alone is not enough to claim that a field can be evaluated safely.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.44
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.42
 * @see https://github.com/UseJunior/safe-docx/issues/762
 */
export function classifyFieldInstruction(
  instructionText: string,
): FieldInstructionClassification {
  const tokens = tokenizeFieldInstruction(instructionText);
  if (!tokens) {
    return {
      kind: 'UNKNOWN',
      evaluationClass: 'unknown',
      normalizedInstruction: instructionText.trim().replace(/\s+/gu, ' '),
      switches: [],
      unsupportedSwitches: [],
      preservationSupported: false,
      reason: 'malformed-field-instruction',
    };
  }
  const keyword = tokens[0]?.value.toUpperCase() ?? '';
  const canonicalTokens = tokens.map((token, index) => ({
    ...token,
    value:
      index === 0
        ? keyword
        : token.value.startsWith('\\')
          ? token.value.toLowerCase()
          : tokens[index - 1]?.value.toLowerCase() === '\\*'
            ? token.value.toUpperCase()
            : token.value,
  }));
  const normalizedInstruction = normalizeTokens(canonicalTokens);
  const knownKinds = new Set<WordFieldKind>([
    'PAGE',
    'NUMPAGES',
    'REF',
    'PAGEREF',
    'TOC',
    'SEQ',
  ]);
  const kind: WordFieldKind = knownKinds.has(keyword as WordFieldKind)
    ? (keyword as WordFieldKind)
    : 'UNKNOWN';

  const switches: string[] = [];
  const switchArguments: Array<string | undefined> = [];
  const unsupportedSwitches: string[] = [];
  const parseSwitchTail = (
    start: number,
    allowed: ReadonlySet<string>,
    argumentSwitches: ReadonlySet<string>,
  ): boolean => {
    for (let index = start; index < tokens.length; index += 1) {
      const token = tokens[index]!.value.toLowerCase();
      if (!/^\\.$/u.test(token)) return false;
      const name = token.slice(1);
      switches.push(token);
      switchArguments.push(undefined);
      if (!allowed.has(name)) {
        unsupportedSwitches.push(token);
        return false;
      }
      if (argumentSwitches.has(name)) {
        const argument = tokens[index + 1]?.value;
        if (!argument || argument.startsWith('\\')) return false;
        switchArguments[switchArguments.length - 1] = argument;
        index += 1;
      }
    }
    return true;
  };

  if (kind === 'PAGE' || kind === 'NUMPAGES') {
    const valid = parseSwitchTail(1, new Set(['*', '#']), new Set(['*', '#']));
    return {
      kind,
      evaluationClass: valid ? 'layout-dependent' : 'recognized-unsupported',
      normalizedInstruction,
      switches,
      unsupportedSwitches,
      preservationSupported: valid,
      reason: valid ? undefined : 'unsupported-field-instruction',
    };
  }

  if (kind === 'PAGEREF') {
    const target = tokens[1]?.value;
    const valid =
      Boolean(target && !target.startsWith('\\')) &&
      parseSwitchTail(2, new Set(['h', 'p', '*']), new Set(['*']));
    return {
      kind,
      evaluationClass: valid ? 'layout-dependent' : 'recognized-unsupported',
      normalizedInstruction,
      target,
      switches,
      unsupportedSwitches,
      preservationSupported: valid,
      reason: valid ? undefined : 'unsupported-field-instruction',
    };
  }

  if (kind === 'TOC') {
    return {
      kind,
      evaluationClass: 'layout-dependent',
      normalizedInstruction,
      switches: tokens
        .slice(1)
        .filter((token) => token.value.startsWith('\\'))
        .map((token) => token.value.toLowerCase()),
      unsupportedSwitches: [],
      preservationSupported: true,
    };
  }

  if (kind === 'REF') {
    const target = tokens[1]?.value;
    if (!target || target.startsWith('\\')) {
      return {
        kind,
        evaluationClass: 'recognized-unsupported',
        normalizedInstruction,
        switches,
        unsupportedSwitches,
        preservationSupported: false,
        reason: 'missing-ref-target',
      };
    }
    const valid = parseSwitchTail(
      2,
      new Set(['d', 'f', 'h', 'n', 'p', 'r', 't', 'w', '*']),
      new Set(['d', '*']),
    );
    if (!valid) {
      return {
        kind,
        evaluationClass: 'recognized-unsupported',
        normalizedInstruction,
        target,
        switches,
        unsupportedSwitches,
        preservationSupported: false,
        reason: 'unsupported-ref-switch',
      };
    }
    const deterministic = switches.every((fieldSwitch, index) => {
      if (fieldSwitch === '\\h') return true;
      if (fieldSwitch !== '\\*') return false;
      return switchArguments[index]?.toUpperCase() === 'MERGEFORMAT';
    });
    if (!deterministic) {
      return {
        kind,
        evaluationClass: 'recognized-unsupported',
        normalizedInstruction,
        target,
        switches,
        unsupportedSwitches: switches.filter((fieldSwitch) => fieldSwitch !== '\\h'),
        preservationSupported: true,
        reason: 'unsupported-ref-switch',
      };
    }
    return {
      kind,
      evaluationClass: 'deterministic-ref',
      normalizedInstruction,
      target,
      switches,
      unsupportedSwitches,
      preservationSupported: true,
    };
  }

  return {
    kind,
    evaluationClass: kind === 'UNKNOWN' ? 'unknown' : 'recognized-unsupported',
    normalizedInstruction,
    switches,
    unsupportedSwitches,
    preservationSupported: false,
    reason: kind === 'UNKNOWN' ? 'unknown-field-kind' : 'field-kind-not-evaluated',
  };
}
