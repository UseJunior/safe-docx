import {
  DocumentPropertiesError,
  validateDocumentPropertyValue,
  type DocumentPropertiesMutation,
} from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import type { SessionManager } from '../session/manager.js';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
} from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';
import {
  APP_PROPERTY_TOOL_NAMES,
  CORE_PROPERTY_TOOL_NAMES,
  projectDocumentPropertiesForTool,
} from './get_document_properties.js';

export type SetDocumentPropertiesParams = {
  file_path?: string;
  core?: unknown;
  app?: unknown;
};

/** Core properties the tool reports but does not write. */
const READ_ONLY_CORE = new Set(['identifier', 'version', 'last_printed']);

/** Settable tool names, snake_case to docx-core camelCase. */
const SETTABLE_CORE: ReadonlyMap<string, string> = new Map(
  Object.entries(CORE_PROPERTY_TOOL_NAMES)
    .filter(([, toolName]) => !READ_ONLY_CORE.has(toolName))
    .map(([name, toolName]) => [toolName, name]),
);
const SETTABLE_APP: ReadonlyMap<string, string> = new Map(Object.entries(APP_PROPERTY_TOOL_NAMES).map(([name, toolName]) => [toolName, name]));

type Parsed = { ok: true; mutation: DocumentPropertiesMutation } | { ok: false; response: ToolResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string, hint: string): Parsed {
  return { ok: false, response: err('VALIDATION_ERROR', message, hint) };
}

/**
 * Turn the tool's `core` / `app` objects into a docx-core write, checking
 * every name and value before any session is touched.
 */
export function parseDocumentPropertiesParams(params: SetDocumentPropertiesParams): Parsed {
  const mutation: DocumentPropertiesMutation = {};
  let count = 0;
  for (const part of ['core', 'app'] as const) {
    const value = params[part];
    if (value === undefined) continue;
    if (!isRecord(value)) {
      return validationError(`${part} must be an object of property values.`, `Pass ${part} as an object, such as {"title": "Agreement"}.`);
    }
    const settable = part === 'core' ? SETTABLE_CORE : SETTABLE_APP;
    const writes: Record<string, string | null> = {};
    for (const [toolName, raw] of Object.entries(value)) {
      if (raw === undefined) continue;
      if (part === 'core' && READ_ONLY_CORE.has(toolName)) {
        return validationError(`core.${toolName} is read-only in set_document_properties.`, `Settable core properties: ${[...settable.keys()].join(', ')}.`);
      }
      const name = settable.get(toolName);
      if (!name) {
        return validationError(`${part}.${toolName} is not a supported document property.`, `Settable ${part} properties: ${[...settable.keys()].join(', ')}.`);
      }
      let text: unknown = raw;
      if (part === 'core' && toolName === 'revision' && typeof raw === 'number') {
        if (!Number.isSafeInteger(raw) || raw < 0) {
          return validationError('core.revision must be a non-negative integer.', 'Pass revision as an integer such as 3, or null to remove it.');
        }
        text = String(raw);
      }
      try {
        validateDocumentPropertyValue(part, name, text);
      } catch (error) {
        if (!(error instanceof DocumentPropertiesError)) throw error;
        return validationError(
          error.message.replace(`${part}.${name}`, `${part}.${toolName}`),
          'Pass a non-empty string (an integer for revision), or null to remove the property.',
        );
      }
      writes[name] = text as string | null;
      count++;
    }
    mutation[part] = writes;
  }
  if (count === 0) {
    return validationError(
      'At least one document property must be provided.',
      'Pass core and/or app with at least one property, such as {"core": {"title": "Agreement"}}.',
    );
  }
  return { ok: true, mutation };
}

export async function setDocumentProperties(
  manager: SessionManager,
  params: SetDocumentPropertiesParams,
): Promise<ToolResponse> {
  const parsed = parseDocumentPropertiesParams(params);
  if (!parsed.ok) return parsed.response;

  try {
    const resolved = await resolveSessionForTool(manager, params, {
      toolName: 'set_document_properties',
    });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;
    return await manager.mutateSession(session, async (session) => {
      const result = await session.doc.setDocumentProperties(parsed.mutation);
      if (result.changed) {
        manager.markEdited(session);
        // Document properties have no tracked-change form (#122): record the
        // package mutation so the save report accounts for it.
        manager.recordNonRevisionChange(session, {
          tool: 'set_document_properties',
          parts: [...result.partsChanged],
          description: `Document properties updated in ${result.partsChanged.join(', ')}${result.partsCreated.length > 0 ? ` (created ${result.partsCreated.join(', ')})` : ''}. Document properties have no tracked-change form, so this change is untracked.`,
        });
      }
      manager.touch(session);
      return ok(mergeSessionResolutionMetadata({
        file_path: manager.normalizePath(session.originalPath),
        changed: result.changed,
        previous: projectDocumentPropertiesForTool(result.previous),
        resulting: projectDocumentPropertiesForTool(result.current),
        parts_created: result.partsCreated,
        parts_changed: result.partsChanged,
        message: result.changed
          ? 'Document properties updated. They have no tracked-change form; the change is listed in the save report non-revision change manifest.'
          : 'Document properties already matched the requested values; nothing was written.',
      }, metadata));
    });
  } catch (error: unknown) {
    if (error instanceof DocumentPropertiesError) {
      return err(
        error.code === 'INVALID_DOCUMENT_PROPERTIES_PART' ? error.code : 'VALIDATION_ERROR',
        error.message,
        error.code === 'INVALID_DOCUMENT_PROPERTIES_PART'
          ? 'The document properties part is malformed; repair or remove it before setting properties.'
          : 'Pass a non-empty string (an integer for revision), or null to remove the property.',
      );
    }
    return err(
      'SET_DOCUMENT_PROPERTIES_ERROR',
      `Failed to set document properties: ${errorMessage(error)}`,
      'Call get_document_properties, verify the document, and retry.',
    );
  }
}
