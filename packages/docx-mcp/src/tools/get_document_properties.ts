import { DocumentPropertiesError, type DocumentProperties } from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import type { SessionManager } from '../session/manager.js';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
} from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

/** Tool-surface (snake_case) name of each core property, by its docx-core name. */
export const CORE_PROPERTY_TOOL_NAMES = {
  title: 'title',
  subject: 'subject',
  creator: 'creator',
  keywords: 'keywords',
  description: 'description',
  category: 'category',
  contentStatus: 'content_status',
  language: 'language',
  identifier: 'identifier',
  version: 'version',
  lastModifiedBy: 'last_modified_by',
  revision: 'revision',
  created: 'created',
  modified: 'modified',
  lastPrinted: 'last_printed',
} as const satisfies Record<keyof DocumentProperties['core'], string>;

/** Tool-surface (snake_case) name of each extended property, by its docx-core name. */
export const APP_PROPERTY_TOOL_NAMES = {
  application: 'application',
  appVersion: 'app_version',
  company: 'company',
  manager: 'manager',
  template: 'template',
} as const satisfies Record<keyof DocumentProperties['app'], string>;

/** Project document properties onto the tool surface: snake_case names, null for an absent property or part. */
export function projectDocumentPropertiesForTool(properties: DocumentProperties) {
  const core: Record<string, string | null> = {};
  for (const [name, toolName] of Object.entries(CORE_PROPERTY_TOOL_NAMES)) {
    core[toolName] = properties.core[name as keyof DocumentProperties['core']];
  }
  const app: Record<string, string | null> = {};
  for (const [name, toolName] of Object.entries(APP_PROPERTY_TOOL_NAMES)) {
    app[toolName] = properties.app[name as keyof DocumentProperties['app']];
  }
  return {
    core,
    app,
    core_part: properties.corePart,
    app_part: properties.appPart,
  };
}

export async function getDocumentProperties(
  manager: SessionManager,
  params: { file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, {
    toolName: 'get_document_properties',
  });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const properties = await session.doc.getDocumentProperties();
    manager.touch(session);
    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      ...projectDocumentPropertiesForTool(properties),
    }, metadata));
  } catch (error: unknown) {
    if (error instanceof DocumentPropertiesError) {
      return err(error.code, error.message, 'The document properties part is malformed; repair or remove it before reading properties.');
    }
    return err(
      'GET_DOCUMENT_PROPERTIES_ERROR',
      `Failed to read document properties: ${errorMessage(error)}`,
      'Validate the DOCX package and retry.',
    );
  }
}
