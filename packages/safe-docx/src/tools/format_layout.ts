import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import type {
  ParagraphSpacingMutation,
  SpacingLineRule,
  RowHeightRule,
  TableCellPaddingMutation,
  TableRowHeightMutation,
} from '@usejunior/docx-primitives';
import { DocxDocument } from '@usejunior/docx-primitives';

type ParagraphSpacingInput = {
  paragraph_ids?: unknown;
  before_twips?: unknown;
  after_twips?: unknown;
  line_twips?: unknown;
  line_rule?: unknown;
};

type RowHeightInput = {
  table_indexes?: unknown;
  row_indexes?: unknown;
  value_twips?: unknown;
  rule?: unknown;
};

type CellPaddingInput = {
  table_indexes?: unknown;
  row_indexes?: unknown;
  cell_indexes?: unknown;
  top_dxa?: unknown;
  bottom_dxa?: unknown;
  left_dxa?: unknown;
  right_dxa?: unknown;
};

type FormatLayoutParams = {
  session_id?: string;
  file_path?: string;
  strict?: boolean;
  paragraph_spacing?: ParagraphSpacingInput;
  row_height?: RowHeightInput;
  cell_padding?: CellPaddingInput;
};

const LINE_RULES = new Set<SpacingLineRule>(['auto', 'exact', 'atLeast']);
const ROW_HEIGHT_RULES = new Set<RowHeightRule>(['auto', 'exact', 'atLeast']);

type ValidationError = {
  kind: 'validation_error';
  message: string;
  hint: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string, hint: string): ValidationError {
  return { kind: 'validation_error', message, hint };
}

function isValidationError(value: unknown): value is ValidationError {
  return isRecord(value) && value.kind === 'validation_error';
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function parseNonNegativeInteger(name: string, value: unknown): number | ValidationError {
  if (!isInteger(value)) {
    return validationError(`${name} must be an integer.`, `Pass a whole number for ${name}.`);
  }
  if (value < 0) {
    return validationError(`${name} must be >= 0.`, `Use a non-negative integer for ${name}.`);
  }
  return value;
}

function parseOptionalNonNegativeInteger(name: string, value: unknown): number | undefined | ValidationError {
  if (typeof value === 'undefined') return undefined;
  return parseNonNegativeInteger(name, value);
}

function parseIndexArray(name: string, value: unknown): number[] | ValidationError {
  if (!Array.isArray(value) || value.length === 0) {
    return validationError(`${name} must be a non-empty array of indexes.`, `Provide one or more numeric indexes in ${name}.`);
  }

  const out: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < value.length; i++) {
    const parsed = parseNonNegativeInteger(`${name}[${i}]`, value[i]);
    if (isValidationError(parsed)) return parsed;
    if (!seen.has(parsed)) {
      seen.add(parsed);
      out.push(parsed);
    }
  }
  return out;
}

function parseOptionalIndexArray(name: string, value: unknown): number[] | undefined | ValidationError {
  if (typeof value === 'undefined') return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    return validationError(`${name} must be a non-empty array when provided.`, `Remove ${name} or provide one or more numeric indexes.`);
  }
  return parseIndexArray(name, value);
}

function parseParagraphSpacingMutation(input: unknown): ParagraphSpacingMutation | ValidationError | null {
  if (typeof input === 'undefined') return null;
  if (!isRecord(input)) {
    return validationError('paragraph_spacing must be an object.', 'Provide paragraph_spacing with paragraph_ids and spacing fields.');
  }

  const idsRaw = input.paragraph_ids;
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    return validationError('paragraph_spacing.paragraph_ids must be a non-empty array.', 'Pass one or more jr_para_* identifiers.');
  }
  const paragraphIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    if (typeof id !== 'string' || id.trim().length === 0) {
      return validationError(`paragraph_spacing.paragraph_ids[${i}] must be a non-empty string.`, 'Use paragraph ids like jr_para_123abc...');
    }
    const trimmed = id.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      paragraphIds.push(trimmed);
    }
  }

  const beforeTwips = parseOptionalNonNegativeInteger('paragraph_spacing.before_twips', input.before_twips);
  if (isValidationError(beforeTwips)) return beforeTwips;
  const afterTwips = parseOptionalNonNegativeInteger('paragraph_spacing.after_twips', input.after_twips);
  if (isValidationError(afterTwips)) return afterTwips;
  const lineTwips = parseOptionalNonNegativeInteger('paragraph_spacing.line_twips', input.line_twips);
  if (isValidationError(lineTwips)) return lineTwips;

  let lineRule: SpacingLineRule | undefined;
  if (typeof input.line_rule !== 'undefined') {
    if (typeof input.line_rule !== 'string' || !LINE_RULES.has(input.line_rule as SpacingLineRule)) {
      return validationError(
        'paragraph_spacing.line_rule is invalid.',
        "Use one of: 'auto', 'exact', 'atLeast'.",
      );
    }
    lineRule = input.line_rule as SpacingLineRule;
  }

  if (
    typeof beforeTwips === 'undefined'
    && typeof afterTwips === 'undefined'
    && typeof lineTwips === 'undefined'
    && typeof lineRule === 'undefined'
  ) {
    return validationError(
      'paragraph_spacing requires at least one spacing property.',
      'Provide one or more of before_twips, after_twips, line_twips, line_rule.',
    );
  }

  return {
    paragraphIds,
    beforeTwips,
    afterTwips,
    lineTwips,
    lineRule,
  };
}

function parseRowHeightMutation(input: unknown): TableRowHeightMutation | ValidationError | null {
  if (typeof input === 'undefined') return null;
  if (!isRecord(input)) {
    return validationError('row_height must be an object.', 'Provide row_height with table_indexes, value_twips, and rule.');
  }

  const tableIndexes = parseIndexArray('row_height.table_indexes', input.table_indexes);
  if (isValidationError(tableIndexes)) return tableIndexes;

  const rowIndexes = parseOptionalIndexArray('row_height.row_indexes', input.row_indexes);
  if (isValidationError(rowIndexes)) return rowIndexes;

  const valueTwips = parseNonNegativeInteger('row_height.value_twips', input.value_twips);
  if (isValidationError(valueTwips)) return valueTwips;

  if (typeof input.rule !== 'string' || !ROW_HEIGHT_RULES.has(input.rule as RowHeightRule)) {
    return validationError('row_height.rule is invalid.', "Use one of: 'auto', 'exact', 'atLeast'.");
  }

  return {
    tableIndexes,
    rowIndexes,
    valueTwips,
    rule: input.rule as RowHeightRule,
  };
}

function parseCellPaddingMutation(input: unknown): TableCellPaddingMutation | ValidationError | null {
  if (typeof input === 'undefined') return null;
  if (!isRecord(input)) {
    return validationError('cell_padding must be an object.', 'Provide cell_padding with table_indexes and padding side fields.');
  }

  const tableIndexes = parseIndexArray('cell_padding.table_indexes', input.table_indexes);
  if (isValidationError(tableIndexes)) return tableIndexes;

  const rowIndexes = parseOptionalIndexArray('cell_padding.row_indexes', input.row_indexes);
  if (isValidationError(rowIndexes)) return rowIndexes;

  const cellIndexes = parseOptionalIndexArray('cell_padding.cell_indexes', input.cell_indexes);
  if (isValidationError(cellIndexes)) return cellIndexes;

  const topDxa = parseOptionalNonNegativeInteger('cell_padding.top_dxa', input.top_dxa);
  if (isValidationError(topDxa)) return topDxa;
  const bottomDxa = parseOptionalNonNegativeInteger('cell_padding.bottom_dxa', input.bottom_dxa);
  if (isValidationError(bottomDxa)) return bottomDxa;
  const leftDxa = parseOptionalNonNegativeInteger('cell_padding.left_dxa', input.left_dxa);
  if (isValidationError(leftDxa)) return leftDxa;
  const rightDxa = parseOptionalNonNegativeInteger('cell_padding.right_dxa', input.right_dxa);
  if (isValidationError(rightDxa)) return rightDxa;

  if (
    typeof topDxa === 'undefined'
    && typeof bottomDxa === 'undefined'
    && typeof leftDxa === 'undefined'
    && typeof rightDxa === 'undefined'
  ) {
    return validationError(
      'cell_padding requires at least one side value.',
      'Provide one or more of top_dxa, bottom_dxa, left_dxa, right_dxa.',
    );
  }

  return {
    tableIndexes,
    rowIndexes,
    cellIndexes,
    topDxa,
    bottomDxa,
    leftDxa,
    rightDxa,
  };
}

export async function formatLayout(
  manager: SessionManager,
  params: FormatLayoutParams,
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'format_layout' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const strict = params.strict ?? true;
    if (typeof strict !== 'boolean') {
      return err('VALIDATION_ERROR', 'strict must be a boolean.', 'Set strict to true or false.');
    }

    const paragraphSpacing = parseParagraphSpacingMutation(params.paragraph_spacing);
    if (isValidationError(paragraphSpacing)) {
      return err('VALIDATION_ERROR', paragraphSpacing.message, paragraphSpacing.hint);
    }

    const rowHeight = parseRowHeightMutation(params.row_height);
    if (isValidationError(rowHeight)) {
      return err('VALIDATION_ERROR', rowHeight.message, rowHeight.hint);
    }

    const cellPadding = parseCellPaddingMutation(params.cell_padding);
    if (isValidationError(cellPadding)) {
      return err('VALIDATION_ERROR', cellPadding.message, cellPadding.hint);
    }

    if (!paragraphSpacing && !rowHeight && !cellPadding) {
      return err(
        'VALIDATION_ERROR',
        'No layout operation was provided.',
        'Provide at least one of paragraph_spacing, row_height, or cell_padding.',
      );
    }

    if (paragraphSpacing && strict) {
      const missing = paragraphSpacing.paragraphIds.filter((id) => session.doc.getParagraphElementById(id) === null);
      if (missing.length > 0) {
        return err(
          'INVALID_SELECTOR',
          `paragraph_spacing references missing paragraph IDs: ${missing.join(', ')}`,
          'Set strict=false to ignore missing selectors and apply best-effort changes.',
        );
      }
    }

    if (strict && (rowHeight || cellPadding)) {
      // Preflight selectors against a cloned document so strict-mode failures
      // do not partially mutate the active session document.
      const snapshot = await session.doc.toBuffer({ cleanBookmarks: false });
      const previewDoc = await DocxDocument.load(snapshot.buffer);

      if (rowHeight) {
        const rowPreview = previewDoc.setTableRowHeight(rowHeight);
        if (rowPreview.missingTableIndexes.length > 0) {
          return err(
            'INVALID_SELECTOR',
            `row_height missing table indexes: ${rowPreview.missingTableIndexes.join(', ')}`,
            'Set strict=false to allow best-effort application.',
          );
        }
        if (rowPreview.missingRowIndexes.length > 0) {
          return err(
            'INVALID_SELECTOR',
            `row_height missing row indexes: ${rowPreview.missingRowIndexes
              .map((x) => `${x.tableIndex}:${x.rowIndex}`)
              .join(', ')}`,
            'Set strict=false to allow best-effort application.',
          );
        }
      }

      if (cellPadding) {
        const cellPreview = previewDoc.setTableCellPadding(cellPadding);
        if (cellPreview.missingTableIndexes.length > 0) {
          return err(
            'INVALID_SELECTOR',
            `cell_padding missing table indexes: ${cellPreview.missingTableIndexes.join(', ')}`,
            'Set strict=false to allow best-effort application.',
          );
        }
        if (cellPreview.missingRowIndexes.length > 0) {
          return err(
            'INVALID_SELECTOR',
            `cell_padding missing row indexes: ${cellPreview.missingRowIndexes
              .map((x) => `${x.tableIndex}:${x.rowIndex}`)
              .join(', ')}`,
            'Set strict=false to allow best-effort application.',
          );
        }
        if (cellPreview.missingCellIndexes.length > 0) {
          return err(
            'INVALID_SELECTOR',
            `cell_padding missing cell indexes: ${cellPreview.missingCellIndexes
              .map((x) => `${x.tableIndex}:${x.rowIndex}:${x.cellIndex}`)
              .join(', ')}`,
            'Set strict=false to allow best-effort application.',
          );
        }
      }
    }

    const paragraphCountBefore = session.doc.getParagraphs().length;
    const warnings: string[] = [];

    const paragraphSpacingResult = paragraphSpacing ? session.doc.setParagraphSpacing(paragraphSpacing) : null;
    const rowHeightResult = rowHeight ? session.doc.setTableRowHeight(rowHeight) : null;
    const cellPaddingResult = cellPadding ? session.doc.setTableCellPadding(cellPadding) : null;

    const paragraphCountAfter = session.doc.getParagraphs().length;
    if (paragraphCountAfter !== paragraphCountBefore) {
      return err(
        'INVARIANT_VIOLATION',
        `Layout formatting changed paragraph count (${paragraphCountBefore} -> ${paragraphCountAfter}).`,
        'Layout operations must only mutate OOXML spacing/geometry and must not insert spacer paragraphs.',
      );
    }

    if (paragraphSpacingResult && paragraphSpacingResult.missingParagraphIds.length > 0) {
      const message = `paragraph_spacing skipped missing paragraph IDs: ${paragraphSpacingResult.missingParagraphIds.join(', ')}`;
      if (strict) {
        return err('INVALID_SELECTOR', message, 'Set strict=false to allow best-effort application.');
      }
      warnings.push(message);
    }
    if (rowHeightResult) {
      if (rowHeightResult.missingTableIndexes.length > 0) {
        const message = `row_height missing table indexes: ${rowHeightResult.missingTableIndexes.join(', ')}`;
        if (strict) return err('INVALID_SELECTOR', message, 'Set strict=false to allow best-effort application.');
        warnings.push(message);
      }
      if (rowHeightResult.missingRowIndexes.length > 0) {
        const message = `row_height missing row indexes: ${rowHeightResult.missingRowIndexes
          .map((x) => `${x.tableIndex}:${x.rowIndex}`)
          .join(', ')}`;
        if (strict) return err('INVALID_SELECTOR', message, 'Set strict=false to allow best-effort application.');
        warnings.push(message);
      }
    }
    if (cellPaddingResult) {
      if (cellPaddingResult.missingTableIndexes.length > 0) {
        const message = `cell_padding missing table indexes: ${cellPaddingResult.missingTableIndexes.join(', ')}`;
        if (strict) return err('INVALID_SELECTOR', message, 'Set strict=false to allow best-effort application.');
        warnings.push(message);
      }
      if (cellPaddingResult.missingRowIndexes.length > 0) {
        const message = `cell_padding missing row indexes: ${cellPaddingResult.missingRowIndexes
          .map((x) => `${x.tableIndex}:${x.rowIndex}`)
          .join(', ')}`;
        if (strict) return err('INVALID_SELECTOR', message, 'Set strict=false to allow best-effort application.');
        warnings.push(message);
      }
      if (cellPaddingResult.missingCellIndexes.length > 0) {
        const message = `cell_padding missing cell indexes: ${cellPaddingResult.missingCellIndexes
          .map((x) => `${x.tableIndex}:${x.rowIndex}:${x.cellIndex}`)
          .join(', ')}`;
        if (strict) return err('INVALID_SELECTOR', message, 'Set strict=false to allow best-effort application.');
        warnings.push(message);
      }
    }

    const affectedParagraphs = paragraphSpacingResult?.affectedParagraphs ?? 0;
    const affectedRows = rowHeightResult?.affectedRows ?? 0;
    const affectedCells = cellPaddingResult?.affectedCells ?? 0;
    const totalAffected = affectedParagraphs + affectedRows + affectedCells;
    if (totalAffected > 0) {
      manager.markEdited(session);
    }
    manager.touch(session);

    return ok(mergeSessionResolutionMetadata({
      session_id: session.sessionId,
      strict,
      mutation_summary: {
        affected_paragraphs: affectedParagraphs,
        affected_rows: affectedRows,
        affected_cells: affectedCells,
      },
      paragraph_spacing_result: paragraphSpacingResult ?? undefined,
      row_height_result: rowHeightResult ?? undefined,
      cell_padding_result: cellPaddingResult ?? undefined,
      no_spacer_paragraphs: paragraphCountBefore === paragraphCountAfter,
      paragraph_count_before: paragraphCountBefore,
      paragraph_count_after: paragraphCountAfter,
      warnings,
      message: totalAffected > 0
        ? 'Layout formatting applied with deterministic OOXML geometry mutations.'
        : 'No document nodes matched the provided selectors.',
    }, metadata));
  } catch (e: unknown) {
    const message = errorMessage(e);
    return err('FORMAT_LAYOUT_ERROR', `Failed to apply layout formatting: ${message}`, 'Check selector inputs and retry.');
  }
}
