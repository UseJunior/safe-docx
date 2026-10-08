// Generic Markdoc → docx-core DocumentSpec engine (upstreamed from
// legal-explainer's markdocx package). Domain adapters plug in through the
// Theme, block/inline tag plugins, resolveField and transformBlock seams.
export * from './ast.js';
export * from './default-theme.js';
export * from './engine.js';
export * from './render.js';
