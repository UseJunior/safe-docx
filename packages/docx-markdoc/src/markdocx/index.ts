// Generic Markdoc → docx-core DocumentSpec engine. Domain adapters plug in
// through the Theme, block/inline tag plugins, resolveField and
// transformBlock seams.
export * from './ast.js';
export * from './default-theme.js';
export * from './engine.js';
export * from './render.js';
