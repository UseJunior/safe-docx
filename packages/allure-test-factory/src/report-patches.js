// String constants for browser-side injection into Allure report HTML.
// No vitest imports — safe for use in plain Node scripts.

/**
 * CSS for HTML attachment previews: auto-sized iframes and inline rendering.
 * Inject into the report's theme/branding CSS file.
 */
export const ATTACHMENT_PREVIEW_CSS = `
/* Make HTML attachments feel inlined/readable without cramped iframe viewports */
[data-testid="test-result-attachment"] [class*="html-attachment-preview"] {
  min-height: 0 !important;
  max-height: 72vh !important;
  overflow-x: hidden;
  overflow-y: hidden;
}

[data-testid="test-result-attachment"] [class*="html-attachment-preview"] iframe {
  width: 100% !important;
  min-height: 0 !important;
  border: 0 !important;
}

/* Expanded attachment modal should be larger than inline preview */
[role="dialog"] [data-testid="test-result-attachment"] [class*="html-attachment-preview"],
[role="dialog"] [class*="html-attachment-preview"] {
  min-height: 0 !important;
  max-height: 90vh !important;
}

[role="dialog"] [data-testid="test-result-attachment"] [class*="html-attachment-preview"] iframe,
[role="dialog"] [class*="html-attachment-preview"] iframe {
  min-height: 0 !important;
}

[data-testid="test-result-attachment"] .Yino1buJ,
[data-testid="test-result-attachment"] .Px8Q9Npk {
  overflow: visible !important;
}
`.trim();

/**
 * Browser-side JS function body (as a string) that auto-sizes HTML attachment iframes
 * to match their content height. Runs in MutationObserver context.
 *
 * Expects to be called as a function with no arguments inside the report page.
 */
export const AUTO_SIZE_HTML_ATTACHMENT_FRAMES_JS = `
function autoSizeHtmlAttachmentFrames() {
  var clamp = function(value, min, max) { return Math.min(max, Math.max(min, value)); };

  var resizeFrame = function(frame) {
    try {
      var doc = frame.contentDocument;
      if (!doc) return;
      var inDialog = !!frame.closest('[role="dialog"]');
      var min = 0;
      var max = inDialog
        ? Math.max(420, Math.floor(window.innerHeight * 0.9))
        : Math.max(220, Math.floor(window.innerHeight * 0.72));
      var root = doc.getElementById('allure-auto-size-root');
      var rootHeight = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
      var bodyHeight = doc.body ? doc.body.scrollHeight : 0;
      var contentHeight = Math.max(rootHeight, bodyHeight, 0);
      if (contentHeight <= 0) return;
      var contentTarget = Math.max(min, contentHeight + 8);
      var previewTarget = clamp(contentTarget, min, max);
      var overflowNeeded = contentTarget > max;

      var preview = frame.closest('[class*="html-attachment-preview"]');
      if (preview) {
        preview.style.height = String(previewTarget) + 'px';
        preview.style.minHeight = '0px';
        preview.style.maxHeight = String(max) + 'px';
        preview.style.setProperty('overflow-y', overflowNeeded ? 'auto' : 'hidden', 'important');
        preview.style.setProperty('overflow-x', 'hidden', 'important');
      }
      frame.setAttribute('scrolling', 'no');
      frame.style.height = String(contentTarget) + 'px';
      frame.style.minHeight = '0px';
      frame.style.overflow = 'hidden';
    } catch (e) {
      // Cross-origin or transient iframe states should not break report interactivity.
    }
  };

  document
    .querySelectorAll('[data-testid="test-result-attachment"] [class*="html-attachment-preview"] iframe')
    .forEach(function(frame) {
      if (frame.dataset.autoSizedAttached !== "1") {
        frame.addEventListener('load', function() { resizeFrame(frame); });
        frame.dataset.autoSizedAttached = "1";
      }
      resizeFrame(frame);
    });
}
`.trim();

/**
 * Browser-side JS function body (as a string) that converts inline HTML source code
 * (rendered as raw text in a <pre> by Allure) into sandboxed iframes for visual preview.
 *
 * Security: sandbox="allow-same-origin" without allow-scripts prevents script execution.
 * DOMPurify sanitization is applied when available for defense in depth.
 *
 * Must run BEFORE autoSizeHtmlAttachmentFrames so new iframes get sized.
 */
export const CONVERT_INLINE_HTML_TO_IFRAME_JS = `
function convertInlineHtmlToIframe() {
  document
    .querySelectorAll('[data-testid="test-result-attachment"]')
    .forEach(function(attachment) {
      if (attachment.dataset.inlineHtmlConverted === "1") return;

      // Only process text/html attachments
      var header = attachment.querySelector('[data-testid="test-result-attachment-header"]');
      if (!header) return;
      var metaTokens = Array.from(
        header.querySelectorAll('.sXJUrXQT .paragraphs-text-s')
      ).map(function(node) { return (node.textContent || '').trim(); }).filter(Boolean);
      var contentType = metaTokens.find(function(t) { return t.includes('/'); }) || '';
      if (!/text\\/html/i.test(contentType)) return;

      // Find the code block that contains raw HTML source
      var codePre = attachment.querySelector('pre[data-testid="code-attachment-content"]');
      if (!codePre) return;

      var rawHtml = codePre.textContent || '';
      if (!rawHtml.trim()) return;

      // Sanitize with DOMPurify; fail closed (keep code view) if unavailable
      if (typeof DOMPurify === 'undefined' || typeof DOMPurify.sanitize !== 'function') return;
      var sanitizedHtml = DOMPurify.sanitize(rawHtml, {
        WHOLE_DOCUMENT: true,
        ADD_TAGS: ['style', 'link'],
        ADD_ATTR: ['id', 'class', 'style'],
      });

      // Create sandboxed iframe
      var iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-same-origin';
      iframe.style.width = '100%';
      iframe.style.border = '0';
      iframe.style.minHeight = '0';

      // Build the preview container
      var previewDiv = document.createElement('div');
      previewDiv.className = codePre.parentElement?.className || '';
      // Add the html-attachment-preview class pattern for auto-sizing
      if (!previewDiv.className.includes('html-attachment-preview')) {
        previewDiv.className = (previewDiv.className + ' html-attachment-preview').trim();
      }
      previewDiv.appendChild(iframe);

      // Replace the code block with the iframe preview
      var codeContainer = codePre.parentElement || codePre;
      codeContainer.parentElement?.replaceChild(previewDiv, codeContainer);

      // Write content into the iframe
      try {
        var doc = iframe.contentDocument;
        if (doc) {
          doc.open();
          doc.write(sanitizedHtml);
          doc.close();
        }
      } catch (e) {
        // Ignore write failures
      }

      attachment.dataset.inlineHtmlConverted = "1";
    });
}
`.trim();
