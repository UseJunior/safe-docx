import Markdoc, { type Config, type Node } from '@markdoc/markdoc';
import { DocxMarkdocError } from './errors.js';
import { IR_VERSION, type MarkdocEditIR, type Rationale, type SourceParagraph, type ValidationIssue, type ValidationResult } from './types.js';

const stringRequired = { type: String, required: true } as const;

export const markdocConfig: Config = {
  tags: {
    source: {
      selfClosing: true,
      attributes: {
        sha256: stringRequired,
        paragraphs: { type: Number, required: true },
      },
    },
    para: {
      attributes: {
        id: stringRequired,
        fingerprint: stringRequired,
        style: stringRequired,
      },
    },
    ins: { inline: true },
    del: { inline: true },
    change: {
      attributes: {
        id: stringRequired,
        fingerprint: stringRequired,
        style: stringRequired,
        operation: stringRequired,
        format: { type: String, required: true, matches: ['inherit-source-paragraph'] },
        'format-source': { type: String },
      },
    },
    before: {},
    after: {},
    'replace-source': {
      attributes: {
        id: stringRequired,
        fingerprint: stringRequired,
        style: stringRequired,
        operation: stringRequired,
        format: { type: String, required: true, matches: ['inherit-source-paragraph'] },
      },
    },
    'delete-source': {
      selfClosing: true,
      attributes: {
        id: stringRequired,
        fingerprint: stringRequired,
        style: stringRequired,
        operation: stringRequired,
        format: { type: String, required: true, matches: ['inherit-source-paragraph'] },
      },
    },
    'insert-before': {
      attributes: {
        anchor: stringRequired,
        operation: stringRequired,
        'style-source': { type: String },
      },
    },
    'insert-after': {
      attributes: {
        anchor: stringRequired,
        operation: stringRequired,
        'style-source': { type: String },
      },
    },
    rationale: {
      attributes: {
        for: stringRequired,
        category: { type: String },
      },
    },
  },
};

function location(node: Node): number | undefined {
  return node.location?.start.line === undefined ? undefined : node.location.start.line + 1;
}

function issue(code: string, message: string, node?: Node): ValidationIssue {
  return { code, message, line: node ? location(node) : undefined };
}

function textProjection(node: Node, side: 'original' | 'revised', revisionDepth = 0): string {
  if (node.type === 'text') return String(node.attributes.content ?? '');
  if (node.type === 'softbreak' || node.type === 'hardbreak') return '\n';
  if (node.type === 'tag' && (node.tag === 'ins' || node.tag === 'del')) {
    if (revisionDepth > 0) throw new DocxMarkdocError('NESTED_REVISION', 'Revision tags may not be nested.');
    if ((node.tag === 'ins' && side === 'original') || (node.tag === 'del' && side === 'revised')) return '';
    return node.children.map((child) => textProjection(child, side, revisionDepth + 1)).join('');
  }
  return node.children.map((child) => textProjection(child, side, revisionDepth)).join('');
}

function hasRevision(node: Node): boolean {
  return [...node.walk()].some((child) => child.type === 'tag' && (child.tag === 'ins' || child.tag === 'del'));
}

function assertOnlyInlineRevisions(node: Node, issues: ValidationIssue[]): void {
  for (const child of node.walk()) {
    if (child === node || child.type !== 'tag') continue;
    if (child.tag !== 'ins' && child.tag !== 'del') {
      issues.push(issue('UNSUPPORTED_NESTED_TAG', `Unsupported nested tag ${child.tag ?? '<unknown>'}.`, child));
    }
  }
}

function directTagChildren(node: Node): Node[] {
  return node.children.filter((child) => child.type === 'tag');
}

export function parseMarkdoc(source: string): ValidationResult {
  const ast = Markdoc.parse(source);
  const issues: ValidationIssue[] = Markdoc.validate(ast, markdocConfig)
    .filter((entry) => entry.error.level === 'error' || entry.error.level === 'critical')
    .map((entry) => ({
      code: entry.error.id,
      message: entry.error.message,
      line: entry.lines?.[0] === undefined ? undefined : entry.lines[0] + 1,
    }));

  let descriptor: MarkdocEditIR['source'] | undefined;
  const scaffold: SourceParagraph[] = [];
  const operations: MarkdocEditIR['operations'] = [];
  const rationales: Rationale[] = [];
  const sourceIds = new Set<string>();
  const operationIds = new Set<string>();

  for (const node of ast.children) {
    if (node.type === 'comment') continue;
    if (node.type !== 'tag' || !node.tag) {
      issues.push(issue('TOP_LEVEL_TAG_REQUIRED', 'Canonical Markdoc permits only declared top-level tags.', node));
      continue;
    }
    const a = node.attributes;
    if (node.tag === 'source') {
      if (descriptor) issues.push(issue('DUPLICATE_SOURCE', 'Exactly one source tag is required.', node));
      descriptor = { sha256: String(a.sha256 ?? ''), paragraphs: Number(a.paragraphs) };
      continue;
    }
    if (node.tag === 'rationale') {
      rationales.push({
        operationId: String(a.for ?? ''),
        text: textProjection(node, 'revised').trim(),
        category: a.category === undefined ? undefined : String(a.category),
      });
      continue;
    }
    if (node.tag === 'insert-before' || node.tag === 'insert-after') {
      const children = directTagChildren(node);
      const afterNodes = children.filter((child) => child.tag === 'after');
      if (children.some((child) => child.tag !== 'after') || afterNodes.length !== 1) {
        issues.push(issue('INVALID_INSERT_STATES', 'An insertion requires exactly one clean after block; its before state is empty.', node));
      }
      if (afterNodes.some(hasRevision)) issues.push(issue('REVISION_TAGS_NONCANONICAL', 'The after state contains clean text; inline ins/del belongs only in generated views.', node));
      const operationId = String(a.operation ?? '');
      operations.push({
        kind: node.tag,
        operationId,
        anchorId: String(a.anchor ?? ''),
        revisedText: afterNodes[0] ? textProjection(afterNodes[0], 'revised') : '',
        styleSourceId: a['style-source'] === undefined ? undefined : String(a['style-source']),
      });
      if (operationIds.has(operationId)) issues.push(issue('DUPLICATE_OPERATION', `Duplicate operation ID ${operationId}.`, node));
      operationIds.add(operationId);
      continue;
    }

    if (node.tag === 'change') {
      const id = String(a.id ?? '');
      if (sourceIds.has(id)) issues.push(issue('DUPLICATE_SOURCE_ID', `Source paragraph ${id} appears more than once.`, node));
      sourceIds.add(id);
      const children = directTagChildren(node);
      const beforeNodes = children.filter((child) => child.tag === 'before');
      const afterNodes = children.filter((child) => child.tag === 'after');
      if (children.some((child) => child.tag !== 'before' && child.tag !== 'after') || beforeNodes.length !== 1 || afterNodes.length !== 1) {
        issues.push(issue('INVALID_CHANGE_STATES', 'A change requires exactly one before block and one after block.', node));
      }
      const beforeText = beforeNodes[0] ? textProjection(beforeNodes[0], 'original') : '';
      const afterText = afterNodes[0] ? textProjection(afterNodes[0], 'revised') : '';
      if (children.some(hasRevision)) issues.push(issue('REVISION_TAGS_NONCANONICAL', 'Before/after states contain clean text; inline ins/del belongs only in generated views.', node));
      const operationId = String(a.operation ?? '');
      if (operationIds.has(operationId)) issues.push(issue('DUPLICATE_OPERATION', `Duplicate operation ID ${operationId}.`, node));
      operationIds.add(operationId);
      const paragraph: SourceParagraph = {
        id,
        fingerprint: String(a.fingerprint ?? ''),
        style: String(a.style ?? ''),
        originalText: beforeText,
        revisedText: afterText,
      };
      scaffold.push(paragraph);
      operations.push(afterText === ''
        ? { kind: 'delete-source', operationId, format: 'inherit-source-paragraph', ...paragraph }
        : {
          kind: 'replace-source',
          operationId,
          format: 'inherit-source-paragraph',
          formatSource: a['format-source'] === undefined ? undefined : String(a['format-source']),
          ...paragraph,
        });
      continue;
    }

    if (node.tag !== 'para' && node.tag !== 'replace-source' && node.tag !== 'delete-source') {
      issues.push(issue('UNSUPPORTED_TOP_LEVEL_TAG', `Unsupported top-level tag ${node.tag}.`, node));
      continue;
    }
    const id = String(a.id ?? '');
    if (sourceIds.has(id)) issues.push(issue('DUPLICATE_SOURCE_ID', `Source paragraph ${id} appears more than once.`, node));
    sourceIds.add(id);
    assertOnlyInlineRevisions(node, issues);
    const originalText = node.tag === 'replace-source' || node.tag === 'delete-source'
      ? ''
      : textProjection(node, 'original');
    const revisedText = node.tag === 'delete-source' ? '' : textProjection(node, 'revised');
    const paragraph: SourceParagraph = {
      id,
      fingerprint: String(a.fingerprint ?? ''),
      style: String(a.style ?? ''),
      originalText,
      revisedText,
    };
    scaffold.push(paragraph);
    const operationId = a.operation === undefined ? undefined : String(a.operation);
    if (node.tag === 'para' && hasRevision(node)) issues.push(issue('INLINE_REVISIONS_NONCANONICAL', `Paragraph ${id} must be represented as clean before/after states.`, node));
    if (!operationId) continue;
    if (operationIds.has(operationId)) issues.push(issue('DUPLICATE_OPERATION', `Duplicate operation ID ${operationId}.`, node));
    operationIds.add(operationId);
    if (node.tag === 'para') {
      operations.push({ kind: 'inline-edit', operationId, ...paragraph });
    } else if (node.tag === 'replace-source') {
      operations.push({ kind: 'replace-source', operationId, format: 'inherit-source-paragraph', ...paragraph });
    } else {
      operations.push({ kind: 'delete-source', operationId, format: 'inherit-source-paragraph', ...paragraph });
    }
  }

  if (!descriptor) issues.push(issue('MISSING_SOURCE', 'Exactly one source tag is required.'));
  for (const rationale of rationales) {
    if (!operationIds.has(rationale.operationId)) {
      issues.push(issue('ORPHAN_RATIONALE', `Rationale targets unknown operation ${rationale.operationId}.`));
    }
  }
  const rationaleTargets = new Set<string>();
  for (const rationale of rationales) {
    if (rationaleTargets.has(rationale.operationId)) {
      issues.push(issue('MULTIPLE_RATIONALES', `Operation ${rationale.operationId} has more than one rationale block.`));
    }
    rationaleTargets.add(rationale.operationId);
  }
  if (issues.length > 0 || !descriptor) return { valid: false, issues };
  return {
    valid: true,
    ir: { version: IR_VERSION, source: descriptor, scaffold, operations, rationales },
  };
}

export function requireMarkdoc(source: string): MarkdocEditIR {
  const result = parseMarkdoc(source);
  if (!result.valid) throw new DocxMarkdocError('INVALID_MARKDOC', 'Markdoc validation failed.', result.issues);
  return result.ir;
}
