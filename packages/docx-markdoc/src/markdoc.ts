import Markdoc, { type Config, type Node } from '@markdoc/markdoc';
import { DocxMarkdocError } from './errors.js';
import { IR_VERSION, type AtomicChangeSet, type CompilationProfile, type DraftAssertion, type DraftRequirement, type MarkdocEditIR, type Rationale, type RequirementWaiver, type RunFormat, type RunFormatSpan, type SourceParagraph, type ValidationIssue, type ValidationResult } from './types.js';

const stringRequired = { type: String, required: true } as const;
const runFormatAttributes = {
  underline: { type: String, matches: ['single'] },
  highlight: { type: String, matches: ['yellow'] },
};

export const markdocConfig: Config = {
  tags: {
    source: {
      selfClosing: true,
      attributes: {
        sha256: stringRequired,
        paragraphs: { type: Number, required: true },
      },
    },
    compilation: {
      selfClosing: true,
      attributes: {
        'revision-author': { type: String },
        'comment-author': { type: String },
        'comment-initials': { type: String },
        'build-date': { type: String },
        'external-comments': { type: String, matches: ['include', 'omit'] },
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
    'run-format': {
      inline: true,
      attributes: runFormatAttributes,
    },
    change: {
      attributes: {
        id: stringRequired,
        fingerprint: stringRequired,
        style: stringRequired,
        operation: stringRequired,
        format: { type: String, required: true, matches: ['inherit-source-paragraph'] },
        'format-source': { type: String },
        ...runFormatAttributes,
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
        'format-source': { type: String },
        ...runFormatAttributes,
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
        ...runFormatAttributes,
      },
    },
    'insert-before': {
      attributes: {
        anchor: stringRequired,
        operation: stringRequired,
        'style-source': { type: String },
        'format-source': { type: String },
        ...runFormatAttributes,
      },
    },
    'insert-after': {
      attributes: {
        anchor: stringRequired,
        operation: stringRequired,
        'style-source': { type: String },
        'format-source': { type: String },
        ...runFormatAttributes,
      },
    },
    rationale: {
      attributes: {
        for: stringRequired,
        visibility: { type: String, required: true, matches: ['internal', 'external-facing'] },
      },
    },
    requirement: {
      attributes: {
        id: stringRequired,
        'satisfied-by': stringRequired,
        mode: { type: String, matches: ['all', 'any'] },
      },
    },
    waiver: {
      attributes: {
        for: stringRequired,
        authority: stringRequired,
      },
    },
    'change-set': {
      selfClosing: true,
      attributes: {
        id: stringRequired,
        operations: stringRequired,
        atomic: { type: Boolean, required: true },
      },
    },
    assert: {
      selfClosing: true,
      attributes: {
        id: stringRequired,
        kind: { type: String, required: true, matches: ['present', 'absent'] },
        text: stringRequired,
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

function hasRunFormat(node: Node): boolean {
  return [...node.walk()].some((child) => child.type === 'tag' && child.tag === 'run-format');
}

function assertOnlyInlineRevisions(node: Node, issues: ValidationIssue[]): void {
  for (const child of node.walk()) {
    if (child === node || child.type !== 'tag') continue;
    if (child.tag !== 'ins' && child.tag !== 'del' && child.tag !== 'run-format') {
      issues.push(issue('UNSUPPORTED_NESTED_TAG', `Unsupported nested tag ${child.tag ?? '<unknown>'}.`, child));
    }
  }
}

function directTagChildren(node: Node): Node[] {
  return node.children.filter((child) => child.type === 'tag');
}

function assertNoNestedTags(node: Node, issues: ValidationIssue[]): void {
  for (const child of node.walk()) {
    if (child !== node && child.type === 'tag') {
      issues.push(issue('UNSUPPORTED_NESTED_TAG', `Unsupported nested tag ${child.tag ?? '<unknown>'}.`, child));
    }
  }
}

function commaList(value: unknown): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function runFormatFromAttributes(attributes: Record<string, unknown>, node: Node, issues: ValidationIssue[]): RunFormat | undefined {
  const underline = attributes.underline === undefined ? undefined : String(attributes.underline);
  const highlight = attributes.highlight === undefined ? undefined : String(attributes.highlight);
  if (underline !== undefined && underline !== 'single') {
    issues.push(issue('INVALID_RUN_FORMAT', 'underline must be the admitted value "single".', node));
  }
  if (highlight !== undefined && highlight !== 'yellow') {
    issues.push(issue('INVALID_RUN_FORMAT', 'highlight must be the admitted value "yellow".', node));
  }
  if (underline === undefined && highlight === undefined) return undefined;
  return {
    ...(underline === 'single' ? { underline } : {}),
    ...(highlight === 'yellow' ? { highlight } : {}),
  };
}

function revisedProjectionWithRunFormats(node: Node, issues: ValidationIssue[]): { text: string; spans: RunFormatSpan[] } {
  let text = '';
  const spans: RunFormatSpan[] = [];
  const visit = (current: Node, insideRunFormat: boolean): void => {
    if (current.type === 'text') {
      text += String(current.attributes.content ?? '');
      return;
    }
    if (current.type === 'softbreak' || current.type === 'hardbreak') {
      text += '\n';
      return;
    }
    if (current.type === 'tag' && current.tag === 'run-format') {
      if (insideRunFormat) {
        issues.push(issue('NESTED_RUN_FORMAT', 'Inline run-format declarations may not be nested.', current));
      }
      const start = text.length;
      const format = runFormatFromAttributes(current.attributes, current, issues);
      for (const child of current.children) visit(child, true);
      const end = text.length;
      if (end === start) issues.push(issue('EMPTY_RUN_FORMAT_SPAN', 'Inline run-format declarations require non-empty text.', current));
      if (!format) issues.push(issue('EMPTY_RUN_FORMAT', 'Inline run-format declarations require at least one admitted property.', current));
      if (!insideRunFormat && end > start && format) spans.push({ start, end, format });
      return;
    }
    for (const child of current.children) visit(child, insideRunFormat);
  };
  visit(node, false);
  return { text, spans };
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
  let compilation: CompilationProfile | undefined;
  const scaffold: SourceParagraph[] = [];
  const operations: MarkdocEditIR['operations'] = [];
  const rationales: Rationale[] = [];
  const requirements: DraftRequirement[] = [];
  const waivers: RequirementWaiver[] = [];
  const changeSets: AtomicChangeSet[] = [];
  const assertions: DraftAssertion[] = [];
  const sourceIds = new Set<string>();
  const operationIds = new Set<string>();
  const requirementIds = new Set<string>();
  const changeSetIds = new Set<string>();
  const assertionIds = new Set<string>();

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
    if (node.tag === 'compilation') {
      if (compilation) issues.push(issue('DUPLICATE_COMPILATION_PROFILE', 'At most one compilation tag is permitted.', node));
      const revisionAuthor = a['revision-author'] === undefined ? undefined : String(a['revision-author']).trim();
      const commentAuthor = a['comment-author'] === undefined ? undefined : String(a['comment-author']).trim();
      const commentInitials = a['comment-initials'] === undefined ? undefined : String(a['comment-initials']).trim();
      const buildDate = a['build-date'] === undefined ? undefined : String(a['build-date']);
      if (revisionAuthor !== undefined && !revisionAuthor) issues.push(issue('INVALID_COMPILATION_IDENTITY', 'revision-author must be non-empty.', node));
      if (commentAuthor !== undefined && !commentAuthor) issues.push(issue('INVALID_COMPILATION_IDENTITY', 'comment-author must be non-empty.', node));
      if (commentInitials !== undefined && !commentInitials) issues.push(issue('INVALID_COMPILATION_IDENTITY', 'comment-initials must be non-empty.', node));
      if ((commentAuthor === undefined) !== (commentInitials === undefined)) {
        issues.push(issue('INCOMPLETE_COMMENT_IDENTITY', 'comment-author and comment-initials must be declared together.', node));
      }
      if (buildDate !== undefined && (!Number.isFinite(Date.parse(buildDate)) || new Date(buildDate).toISOString() !== buildDate)) {
        issues.push(issue('INVALID_BUILD_DATE', 'build-date must be a canonical ISO-8601 UTC instant.', node));
      }
      compilation = {
        ...(revisionAuthor === undefined ? {} : { revisionAuthor }),
        ...(commentAuthor === undefined ? {} : { commentAuthor }),
        ...(commentInitials === undefined ? {} : { commentInitials }),
        ...(buildDate === undefined ? {} : { buildDate }),
        externalComments: a['external-comments'] === 'omit' ? 'omit' : 'include',
      };
      continue;
    }
    if (node.tag === 'rationale') {
      rationales.push({
        operationId: String(a.for ?? ''),
        text: textProjection(node, 'revised').trim(),
        visibility: a.visibility === 'external-facing' ? 'external-facing' : 'internal',
      });
      continue;
    }
    if (node.tag === 'requirement') {
      assertNoNestedTags(node, issues);
      const id = String(a.id ?? '');
      if (requirementIds.has(id)) issues.push(issue('DUPLICATE_REQUIREMENT', `Duplicate requirement ID ${id}.`, node));
      requirementIds.add(id);
      const satisfiedBy = commaList(a['satisfied-by']);
      if (satisfiedBy.length === 0) issues.push(issue('EMPTY_REQUIREMENT_OPERATIONS', `Requirement ${id} must name at least one satisfying operation.`, node));
      const description = textProjection(node, 'revised').trim();
      if (!description) issues.push(issue('EMPTY_REQUIREMENT_DESCRIPTION', `Requirement ${id} requires a description.`, node));
      if (new Set(satisfiedBy).size !== satisfiedBy.length) issues.push(issue('DUPLICATE_REQUIREMENT_OPERATION', `Requirement ${id} repeats a satisfying operation.`, node));
      requirements.push({ id, description, satisfiedBy, mode: a.mode === 'any' ? 'any' : 'all' });
      continue;
    }
    if (node.tag === 'waiver') {
      assertNoNestedTags(node, issues);
      const requirementId = String(a.for ?? '');
      const authority = String(a.authority ?? '').trim();
      const reason = textProjection(node, 'revised').trim();
      if (!authority || !reason) issues.push(issue('INVALID_WAIVER', `Waiver for ${requirementId} requires non-empty authority and reason.`, node));
      waivers.push({ requirementId, authority, reason });
      continue;
    }
    if (node.tag === 'change-set') {
      const id = String(a.id ?? '');
      if (changeSetIds.has(id)) issues.push(issue('DUPLICATE_CHANGE_SET', `Duplicate change-set ID ${id}.`, node));
      changeSetIds.add(id);
      const operationIdsInSet = commaList(a.operations);
      if (a.atomic !== true) issues.push(issue('NONATOMIC_CHANGE_SET', `Change-set ${id} must declare atomic=true.`, node));
      if (operationIdsInSet.length === 0) issues.push(issue('EMPTY_CHANGE_SET', `Change-set ${id} must name at least one operation.`, node));
      if (new Set(operationIdsInSet).size !== operationIdsInSet.length) issues.push(issue('DUPLICATE_CHANGE_SET_OPERATION', `Change-set ${id} repeats an operation.`, node));
      changeSets.push({ id, operationIds: operationIdsInSet });
      continue;
    }
    if (node.tag === 'assert') {
      const id = String(a.id ?? '');
      if (assertionIds.has(id)) issues.push(issue('DUPLICATE_ASSERTION', `Duplicate assertion ID ${id}.`, node));
      assertionIds.add(id);
      const assertedText = String(a.text ?? '');
      if (!assertedText) issues.push(issue('EMPTY_ASSERTION_TEXT', `Assertion ${id} requires non-empty text.`, node));
      assertions.push({ id, kind: a.kind === 'present' ? 'present' : 'absent', text: assertedText });
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
      const runFormat = runFormatFromAttributes(a, node, issues);
      const afterProjection = afterNodes[0]
        ? revisedProjectionWithRunFormats(afterNodes[0], issues)
        : { text: '', spans: [] };
      if (runFormat && afterProjection.spans.length > 0) issues.push(issue('CONFLICTING_RUN_FORMAT_SCOPE', 'Use either operation-level or inline run formatting, not both.', node));
      if (runFormat && afterNodes[0]?.children.filter((child) => child.type === 'paragraph').length !== 1) {
        issues.push(issue(
          'AMBIGUOUS_RUN_FORMAT_SCOPE',
          `Operation ${operationId} run formatting requires exactly one generated replacement block.`,
          node,
        ));
      }
      operations.push({
        kind: node.tag,
        operationId,
        anchorId: String(a.anchor ?? ''),
        revisedText: afterProjection.text,
        styleSourceId: a['style-source'] === undefined ? undefined : String(a['style-source']),
        formatSource: a['format-source'] === undefined ? undefined : String(a['format-source']),
        runFormat,
        runFormatSpans: afterProjection.spans,
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
      const afterProjection = afterNodes[0]
        ? revisedProjectionWithRunFormats(afterNodes[0], issues)
        : { text: '', spans: [] };
      const afterText = afterProjection.text;
      if (beforeNodes.some(hasRunFormat)) issues.push(issue('RUN_FORMAT_OUTSIDE_AFTER', 'Inline run-format declarations are permitted only in the clean after state.', node));
      if (children.some(hasRevision)) issues.push(issue('REVISION_TAGS_NONCANONICAL', 'Before/after states contain clean text; inline ins/del belongs only in generated views.', node));
      const operationId = String(a.operation ?? '');
      const runFormat = runFormatFromAttributes(a, node, issues);
      if (runFormat && afterProjection.spans.length > 0) issues.push(issue('CONFLICTING_RUN_FORMAT_SCOPE', 'Use either operation-level or inline run formatting, not both.', node));
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
        ? { kind: 'delete-source', operationId, format: 'inherit-source-paragraph', runFormat, runFormatSpans: afterProjection.spans, ...paragraph }
        : {
          kind: 'replace-source',
          operationId,
          format: 'inherit-source-paragraph',
          formatSource: a['format-source'] === undefined ? undefined : String(a['format-source']),
          runFormat,
          runFormatSpans: afterProjection.spans,
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
    const revisedProjection = node.tag === 'delete-source'
      ? { text: '', spans: [] as RunFormatSpan[] }
      : revisedProjectionWithRunFormats(node, issues);
    const revisedText = revisedProjection.text;
    const paragraph: SourceParagraph = {
      id,
      fingerprint: String(a.fingerprint ?? ''),
      style: String(a.style ?? ''),
      originalText,
      revisedText,
    };
    scaffold.push(paragraph);
    const operationId = a.operation === undefined ? undefined : String(a.operation);
    const runFormat = runFormatFromAttributes(a, node, issues);
    if (runFormat && revisedProjection.spans.length > 0) issues.push(issue('CONFLICTING_RUN_FORMAT_SCOPE', 'Use either operation-level or inline run formatting, not both.', node));
    if (node.tag === 'para' && hasRevision(node)) issues.push(issue('INLINE_REVISIONS_NONCANONICAL', `Paragraph ${id} must be represented as clean before/after states.`, node));
    if (!operationId && revisedProjection.spans.length > 0) issues.push(issue('RUN_FORMAT_REQUIRES_OPERATION', `Paragraph ${id} cannot declare run formatting without an edit operation.`, node));
    if (!operationId) continue;
    if (operationIds.has(operationId)) issues.push(issue('DUPLICATE_OPERATION', `Duplicate operation ID ${operationId}.`, node));
    operationIds.add(operationId);
    if (node.tag === 'para') {
      operations.push({ kind: 'inline-edit', operationId, runFormat, runFormatSpans: revisedProjection.spans, ...paragraph });
    } else if (node.tag === 'replace-source') {
      operations.push({
        kind: 'replace-source',
        operationId,
        format: 'inherit-source-paragraph',
        formatSource: a['format-source'] === undefined ? undefined : String(a['format-source']),
        runFormat,
        runFormatSpans: revisedProjection.spans,
        ...paragraph,
      });
    } else {
      operations.push({ kind: 'delete-source', operationId, format: 'inherit-source-paragraph', runFormat, runFormatSpans: revisedProjection.spans, ...paragraph });
    }
  }

  if (!descriptor) issues.push(issue('MISSING_SOURCE', 'Exactly one source tag is required.'));
  for (const rationale of rationales) {
    if (!operationIds.has(rationale.operationId)) {
      issues.push(issue('ORPHAN_RATIONALE', `Rationale targets unknown operation ${rationale.operationId}.`));
    }
  }
  const waiverTargets = new Set<string>();
  for (const waiver of waivers) {
    if (!requirementIds.has(waiver.requirementId)) issues.push(issue('ORPHAN_WAIVER', `Waiver targets unknown requirement ${waiver.requirementId}.`));
    if (waiverTargets.has(waiver.requirementId)) issues.push(issue('MULTIPLE_WAIVERS', `Requirement ${waiver.requirementId} has more than one waiver.`));
    waiverTargets.add(waiver.requirementId);
  }
  const rationaleTargets = new Set<string>();
  for (const rationale of rationales) {
    const target = `${rationale.operationId}\u0000${rationale.visibility}`;
    if (rationaleTargets.has(target)) {
      issues.push(issue(
        'DUPLICATE_RATIONALE_VISIBILITY',
        `Operation ${rationale.operationId} has more than one ${rationale.visibility} rationale.`,
      ));
    }
    rationaleTargets.add(target);
  }
  if (issues.length > 0 || !descriptor) return { valid: false, issues };
  return {
    valid: true,
    ir: { version: IR_VERSION, source: descriptor, scaffold, operations, rationales, compilation, requirements, waivers, changeSets, assertions },
  };
}

export function requireMarkdoc(source: string): MarkdocEditIR {
  const result = parseMarkdoc(source);
  if (!result.valid) throw new DocxMarkdocError('INVALID_MARKDOC', 'Markdoc validation failed.', result.issues);
  return result.ir;
}
