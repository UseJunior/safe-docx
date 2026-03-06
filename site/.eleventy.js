import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, linkify: true });
const mdSafe = new MarkdownIt({ html: false, linkify: false });

function normalizePageUrl(value) {
  if (!value || value === '/') {
    return '/';
  }
  const trimmed = String(value).trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed.replace(/^\/+/, '')}`;
  }
  return trimmed;
}

function depthFromUrl(value) {
  const normalized = normalizePageUrl(value)
    .replace(/\/index\.html$/, '/')
    .replace(/^\/|\/$/g, '');

  if (!normalized) {
    return 0;
  }

  return normalized.split('/').filter(Boolean).length;
}

function rootPrefixForUrl(value) {
  const depth = depthFromUrl(value);
  return depth === 0 ? './' : '../'.repeat(depth);
}

// Matches a conventional-commit PR line from GitHub release notes:
//   * type(scope): title by @author in https://...
const PR_LINE_RE =
  /^\*\s+(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?!?:\s+(?<title>.+?)\s+by\s+@\S+\s+in\s+https?:\/\/\S+\/pull\/(?<num>\d+)\s*$/;

const TYPE_LABELS = {
  feat: 'Features',
  fix: 'Bug Fixes',
  chore: 'Chores',
  refactor: 'Refactoring',
  ci: 'CI / Infrastructure',
  docs: 'Documentation',
  test: 'Tests',
  perf: 'Performance',
  style: 'Style',
  build: 'Build',
};

function formatReleaseNotes(content) {
  if (!content) return '';
  const lines = String(content).split('\n');

  // Grouped entries: Map<label, [{scope, title, num}]>
  const groups = new Map();
  // Lines that don't fit the structured format
  const customSections = [];

  let inWhatsChanged = false;
  let skipSection = false; // true while inside a ### sub-heading of What's Changed
  let inCustomSection = false; // true while collecting custom (non-### inside What's Changed) lines
  let hasUnrecognised = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip full-changelog footer
    if (trimmed.startsWith('**Full Changelog**')) continue;

    // Top-level ## heading
    if (trimmed.startsWith('## ')) {
      if (trimmed === '## What\'s Changed') {
        inWhatsChanged = true;
        skipSection = false;
        inCustomSection = false;
      } else {
        inWhatsChanged = false;
        skipSection = false;
        inCustomSection = true;
        customSections.push(line);
      }
      continue;
    }

    if (inWhatsChanged) {
      // ### sub-headings inside What's Changed are redundant once we group
      if (trimmed.startsWith('### ')) {
        skipSection = false; // reset per-subsection
        continue;
      }

      if (skipSection) continue;

      if (!trimmed) continue; // blank line

      const m = PR_LINE_RE.exec(trimmed);
      if (m) {
        const { type, scope, title, num } = m.groups;
        const label = TYPE_LABELS[type] ?? (type.charAt(0).toUpperCase() + type.slice(1));
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push({ scope: scope ?? null, title, num });
      } else {
        // Unrecognised line inside What's Changed — treat as custom
        customSections.push(line);
        hasUnrecognised = true;
      }
      continue;
    }

    if (inCustomSection) {
      customSections.push(line);
    }
  }

  const parts = [];

  if (hasUnrecognised) {
    parts.push('<div class="cl-warning">Some entries could not be parsed and are shown below.</div>');
  }

  for (const [label, entries] of groups) {
    const items = entries
      .map(({ scope, title, num }) => {
        const scopeHtml = scope ? ` <span class="cl-scope">${escHtml(scope)}</span>` : '';
        const safeTitle = mdSafe.renderInline(title);
        return `<li>${safeTitle}${scopeHtml} <span class="cl-pr">#${num}</span></li>`;
      })
      .join('\n');
    parts.push(
      `<div class="cl-group"><span class="cl-type-label">${escHtml(label)}</span><ul class="cl-entries">${items}</ul></div>`
    );
  }

  if (customSections.length) {
    const customMd = customSections.join('\n').trim();
    if (customMd) {
      parts.push(md.render(customMd));
    }
  }

  return parts.join('\n');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });
  eleventyConfig.addFilter('rootPrefix', (pageUrl) => rootPrefixForUrl(pageUrl));
  eleventyConfig.addFilter('rootHref', (pageUrl, href = '') => {
    const prefix = rootPrefixForUrl(pageUrl);
    const normalizedHref = String(href).replace(/^\/+/, '');
    return `${prefix}${normalizedHref}`;
  });
  eleventyConfig.addFilter('renderMarkdown', (content) => {
    if (!content) return '';
    return md.render(String(content));
  });
  eleventyConfig.addFilter('formatReleaseNotes', formatReleaseNotes);

  return {
    dir: {
      input: 'src',
      includes: '_includes',
      output: '_site',
    },
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
    dataTemplateEngine: 'njk',
  };
}
