import Markdoc from '@markdoc/markdoc';
import {generateDocx, type DocumentSpec} from '@usejunior/docx-core';

import {defaultPreset, type Preset} from './default-theme.js';
import {
  createMarkdocxRenderer,
  type BlockTagPlugin,
  type InlineTagPlugin,
} from './engine.js';

export type RenderMarkdocxOptions = {
  preset?: Preset;
  blockTags?: BlockTagPlugin[];
  inlineTags?: InlineTagPlugin[];
  resolveField?: (name: string) => {text: string; filled: boolean};
  meta?: {title?: string; createdIso?: string};
};

export function renderMarkdocxToDocumentSpec(source: string, options: RenderMarkdocxOptions = {}): DocumentSpec {
  const preset = options.preset ?? defaultPreset;
  const ast = Markdoc.parse(source);
  const renderer = createMarkdocxRenderer({
    theme: preset.theme,
    blockTags: options.blockTags,
    inlineTags: options.inlineTags,
    resolveField: options.resolveField,
  });

  return {
    ...(options.meta ? {meta: options.meta} : {}),
    styles: preset.styles,
    numbering: preset.numbering,
    sections: [
      {
        page: preset.page,
        blocks: renderer.renderBlocks([ast], {listDepth: 0}),
      },
    ],
  };
}

export function renderMarkdocxToDocx(source: string, options?: RenderMarkdocxOptions): Promise<Buffer> {
  return generateDocx(renderMarkdocxToDocumentSpec(source, options));
}
