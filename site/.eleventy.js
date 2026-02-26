import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, linkify: true });

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
