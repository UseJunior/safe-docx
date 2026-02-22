#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const ICON_SOURCE = path.join(SCRIPT_DIR, 'assets', 'safe-docx-mark.svg');
const BRANDING_START = '<!-- safe-docx-branding:start -->';
const BRANDING_END = '<!-- safe-docx-branding:end -->';
const LEGACY_ICON_ID = '#4af8011a58a597dd8fd8c52187120c54';

function parseArgs(argv) {
  const out = { reportDirs: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--report-dir' && argv[i + 1]) {
      out.reportDirs.push(argv[++i]);
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      out.reportDirs.push(arg.slice('--report-dir='.length));
      continue;
    }
  }
  if (out.reportDirs.length === 0) {
    out.reportDirs = ['allure-report-pilot'];
  }
  out.reportDirs = [...new Set(out.reportDirs)];
  return out;
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
}

function stripBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return text;
  const end = text.indexOf(endMarker, start);
  if (end === -1) return text;
  const removeUntil = end + endMarker.length;
  return `${text.slice(0, start)}${text.slice(removeUntil)}`;
}

function stripLegacyManualBranding(text) {
  let next = text;
  next = next.replace(
    /\s*<script>\s*\(\(\)\s*=>\s*\{[\s\S]*?const TARGET_ID = "#4af8011a58a597dd8fd8c52187120c54"[\s\S]*?\}\)\(\);\s*<\/script>\s*/g,
    '\n',
  );
  next = next.replace(
    /\s*<style>\s*:root[\s\S]*?svg\[data-brand-icon-patched="1"\]\s*\{[\s\S]*?\}\s*<\/style>\s*/g,
    '\n',
  );
  return next;
}

function upsertFaviconLinks(html, iconFileWithVersion) {
  let next = html
    .replace(/\s*<link rel="icon"[^>]*>\s*/g, '\n')
    .replace(/\s*<link rel="shortcut icon"[^>]*>\s*/g, '\n');

  const titleRe = /<title>[\s\S]*?<\/title>/;
  if (!titleRe.test(next)) return next;

  const insert = [
    '<title> SafeDocX Quality Report </title>',
    `    <link rel="icon" type="image/svg+xml" href="./${iconFileWithVersion}" />`,
    `    <link rel="shortcut icon" href="./${iconFileWithVersion}" />`,
  ].join('\n');

  next = next.replace(titleRe, insert);
  return next;
}

function updateAllureOptions(html, iconFileWithVersion) {
  const match = html.match(/window\.allureReportOptions\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!match) return html;

  let options;
  try {
    options = JSON.parse(match[1]);
  } catch {
    return html;
  }

  options.reportName = 'SafeDocX Quality Report (Preview)';
  options.logo = `./${iconFileWithVersion}`;
  options.theme = 'light';

  return html.replace(match[1], JSON.stringify(options));
}

function makeBrandingBlock(iconFileWithVersion) {
  return `
${BRANDING_START}
    <script>
      (() => {
        const ICON_URL = "./${iconFileWithVersion}";
        const LEGACY_ICON_ID = "${LEGACY_ICON_ID}";

        const patchSvgWithBrand = (svg) => {
          if (!svg) return;
          if (svg.dataset.brandIconPatched === "1") return;
          svg.dataset.brandIconPatched = "1";
          svg.style.background = \`url("\${ICON_URL}") center / contain no-repeat\`;
          const useEl = svg.querySelector("use");
          if (useEl) {
            useEl.setAttribute("href", "#");
            useEl.setAttribute("xlink:href", "#");
            useEl.style.display = "none";
          }
        };

        const patchReportIcons = () => {
          const legacySelectors = [
            \`use[href="\${LEGACY_ICON_ID}"]\`,
            \`use[xlink\\\\:href="\${LEGACY_ICON_ID}"]\`,
          ];
          document.querySelectorAll(legacySelectors.join(",")).forEach((useEl) => {
            if (useEl.closest(".fma_u1MG")) return;
            patchSvgWithBrand(useEl.closest("svg"));
          });

          document.querySelectorAll("button, [role='menuitem']").forEach((el) => {
            if (!/SafeDocX/.test(el.textContent || "")) return;
            patchSvgWithBrand(el.querySelector("svg"));
          });
        };

        const patchLastUpdatedLabel = () => {
          document.querySelectorAll("span").forEach((el) => {
            if (el.dataset.lastUpdatedPatched === "1") return;
            const versionChild = Array.from(el.children).find((child) =>
              child.tagName === "SPAN" && /Ver:\\s*\\d+\\.\\d+\\.\\d+/.test(child.textContent || "")
            );
            if (!versionChild) return;
            const firstNode = el.childNodes[0];
            if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) return;
            const currentText = firstNode.textContent || "";
            if (/Last Updated:/.test(currentText)) {
              el.dataset.lastUpdatedPatched = "1";
              return;
            }
            firstNode.textContent = \`Last Updated: \${currentText.trim()}\`;
            el.dataset.lastUpdatedPatched = "1";
          });
        };

        const hideThemeToggle = () => {
          document.querySelectorAll("button").forEach((btn) => {
            const label = (btn.getAttribute("aria-label") || "").toLowerCase();
            if (/theme|dark|light/.test(label)) {
              btn.style.display = "none";
            }
          });
        };

        const setQueryParam = (queryValue) => {
          const next = new URL(window.location.href);
          next.searchParams.delete("query");
          if (typeof queryValue === "string") {
            const normalized = queryValue.trim();
            if (normalized.length > 0) {
              next.searchParams.set("query", normalized);
            }
          }
          if (next.href === window.location.href) return;
          window.history.replaceState(null, "", next.href);
          window.dispatchEvent(new Event("replaceState"));
        };

        const clearQueryParam = () => {
          setQueryParam(undefined);
        };

        const navigateHome = () => {
          clearQueryParam();
          const homeButton = document.querySelector(".KayT_VKx .DJELNKs1 button");
          if (homeButton instanceof HTMLElement) {
            homeButton.click();
            return;
          }
          window.location.hash = "#/";
        };

        const findSearchInput = () => {
          const direct = document.querySelector('input[data-testid="search-input"]');
          if (direct instanceof HTMLInputElement) return direct;

          const container = document.querySelector('[data-testid="search-input"]');
          if (container instanceof HTMLInputElement) return container;
          if (!(container instanceof HTMLElement)) return null;

          const nested = container.querySelector("input");
          return nested instanceof HTMLInputElement ? nested : null;
        };

        const setSearchInputValue = (query) => {
          const input = findSearchInput();
          if (!input) return false;

          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, query);
          } else {
            input.value = query;
          }

          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        };

        const setSearchInputValueWithRetry = (query, retries = 8) => {
          if (setSearchInputValue(query)) return;
          if (retries <= 0) return;
          setTimeout(() => setSearchInputValueWithRetry(query, retries - 1), 60);
        };

        const compactLabel = (value) =>
          String(value || "")
            .replaceAll(String.fromCharCode(10), " ")
            .replaceAll(String.fromCharCode(13), " ")
            .replaceAll(String.fromCharCode(9), " ")
            .split(" ")
            .filter(Boolean)
            .join(" ");

        const normalizeLabel = (value) => compactLabel(value).toLowerCase();

        const classNameToString = (value) =>
          typeof value === "string" ? value : value?.baseVal || "";

        const tryRevealTreeLabel = (label) => {
          const target = normalizeLabel(label);
          if (!target) return false;

          const sectionTitle = Array.from(
            document.querySelectorAll('[data-testid="tree-section-title"]'),
          ).find((el) => normalizeLabel(el.textContent) === target);

          if (sectionTitle instanceof HTMLElement) {
            const section = sectionTitle.closest('[data-testid="tree-section"]');
            if (section instanceof HTMLElement) {
              const arrowEl =
                section.querySelector('[data-testid="tree-arrow"] svg') ||
                section.querySelector('[data-testid="tree-arrow"]');
              const isOpened = /opened/i.test(classNameToString(arrowEl?.className));
              if (!isOpened) {
                section.click();
              }
              section.scrollIntoView({ block: "center", inline: "nearest" });
              return true;
            }
          }

          const leafTitle = Array.from(
            document.querySelectorAll('[data-testid="tree-leaf-title"]'),
          ).find((el) => normalizeLabel(el.textContent) === target);
          if (leafTitle instanceof HTMLElement) {
            const leaf = leafTitle.closest('[data-testid="tree-item"]') || leafTitle;
            if (leaf instanceof HTMLElement) {
              leaf.scrollIntoView({ block: "center", inline: "nearest" });
            }
            return true;
          }

          return false;
        };

        const revealTreeLabelWithRetry = (label, retries = 12) => {
          if (tryRevealTreeLabel(label)) return;
          if (retries <= 0) return;
          setTimeout(() => revealTreeLabelWithRetry(label, retries - 1), 80);
        };

        const patchHomeButtonBehavior = () => {
          const homeButton = document.querySelector(".KayT_VKx .DJELNKs1 button");
          if (!(homeButton instanceof HTMLElement)) return;
          if (homeButton.dataset.clearQueryPatched === "1") return;
          homeButton.dataset.clearQueryPatched = "1";
          homeButton.addEventListener(
            "click",
            () => {
              clearQueryParam();
              setSearchInputValueWithRetry("", 2);
            },
            { capture: true },
          );
        };

        const getActiveTestResultId = () => {
          let raw = window.location.hash || "";
          if (raw.startsWith("#/")) {
            raw = raw.slice(2);
          } else if (raw.startsWith("#")) {
            raw = raw.slice(1);
          }
          const [first] = raw.split("/").filter(Boolean);
          if (!first || first === "charts" || first === "timeline") return null;
          return first;
        };

        const navigateFromBreadcrumb = (label, isLeaf) => {
          if (isLeaf) {
            const activeId = getActiveTestResultId();
            if (activeId) {
              window.location.hash = "#" + activeId;
            }
            return;
          }

          navigateHome();
          if (label) {
            revealTreeLabelWithRetry(label);
          }
        };

        const patchBreadcrumbLinks = () => {
          document.querySelectorAll(".KayT_VKx").forEach((container) => {
            const crumbs = Array.from(container.querySelectorAll(".ChConoqG")).filter(
              (node) => !node.classList.contains("DJELNKs1"),
            );

            crumbs.forEach((crumb, index) => {
              if (!(crumb instanceof HTMLElement)) return;
              if (crumb.dataset.breadcrumbLinkPatched === "1") return;

              const labelNode = crumb.querySelector(".vCHAp_yZ");
              const label = compactLabel(labelNode?.textContent || crumb.textContent || "");
              if (!label) return;

              const isLeaf = index === crumbs.length - 1;
              crumb.dataset.breadcrumbLinkPatched = "1";
              crumb.setAttribute("role", "link");
              crumb.setAttribute("tabindex", "0");
              crumb.setAttribute(
                "aria-label",
                isLeaf ? "Open " + label : "Filter tests by " + label,
              );
              crumb.style.cursor = "pointer";

              const activate = (event) => {
                if (
                  event.type === "keydown" &&
                  event.key !== "Enter" &&
                  event.key !== " "
                ) {
                  return;
                }
                if (event.type === "keydown") {
                  event.preventDefault();
                }
                event.stopPropagation();
                navigateFromBreadcrumb(label, isLeaf);
              };

              crumb.addEventListener("click", activate);
              crumb.addEventListener("keydown", activate);
            });
          });
        };

        const resolveBooleanSetting = (key, fallback) => {
          try {
            const config = window.__SDX_ALLURE_CONFIG__;
            if (config && typeof config[key] === "boolean") {
              return config[key];
            }
            const raw = new URL(window.location.href).searchParams.get(key);
            if (!raw) return fallback;
            const normalized = raw.trim().toLowerCase();
            if (["1", "true", "yes", "on"].includes(normalized)) return true;
            if (["0", "false", "no", "off"].includes(normalized)) return false;
          } catch {
            // Ignore malformed URL/config and keep defaults.
          }
          return fallback;
        };

        const resolveEnumSetting = (key, allowedValues, fallback) => {
          try {
            const allowed = new Set(allowedValues);
            const config = window.__SDX_ALLURE_CONFIG__;
            if (config && typeof config[key] === "string") {
              const normalizedConfigValue = config[key].trim().toLowerCase();
              if (allowed.has(normalizedConfigValue)) {
                return normalizedConfigValue;
              }
            }
            const raw = new URL(window.location.href).searchParams.get(key);
            if (!raw) return fallback;
            const normalized = raw.trim().toLowerCase();
            if (allowed.has(normalized)) return normalized;
          } catch {
            // Ignore malformed URL/config and keep defaults.
          }
          return fallback;
        };

        const EXPAND_MODES = ["compact", "moderate", "verbose"];
        const settings = {
          expandMode: resolveEnumSetting("sdxExpandMode", EXPAND_MODES, "moderate"),
          autoExpandAttachmentsOverride: resolveBooleanSetting("sdxAutoExpandAttachments", null),
          autoExpandStepsOverride: resolveBooleanSetting("sdxAutoExpandSteps", null),
        };

        const resolveModeDefault = (mode) => {
          if (mode === "compact") return false;
          if (mode === "verbose") return true;
          // moderate
          return true;
        };

        const getAttachmentExpansionPolicies = (mode) => {
          if (mode === "verbose") {
            return [{ id: "default", autoExpand: true, when: () => true }];
          }

          if (mode === "moderate") {
            return [
              {
                id: "word-like-preview",
                autoExpand: true,
                when: (meta) =>
                  meta.contentType === "text/html" &&
                  /\bword-like\b/.test(meta.title.toLowerCase()),
              },
              {
                id: "debug-json",
                autoExpand: false,
                when: (meta) =>
                  meta.contentType === "application/json" &&
                  (meta.title === "Test context (debug JSON)" ||
                    meta.title === "Final result (debug JSON)"),
              },
              {
                id: "json",
                autoExpand: false,
                when: (meta) => /json/i.test(meta.contentType),
              },
              {
                id: "xml",
                autoExpand: false,
                when: (meta) =>
                  /xml/i.test(meta.contentType) || /\bxml\b/i.test(meta.title),
              },
              { id: "default", autoExpand: true, when: () => true },
            ];
          }

          // compact
          return [{ id: "default", autoExpand: false, when: () => true }];
        };

        const attachmentExpansionPolicies = getAttachmentExpansionPolicies(settings.expandMode);

        const readAttachmentMeta = (header) => {
          const title = compactLabel(
            header.querySelector(".YYCSAKki")?.textContent || "",
          );
          const contentMetaTokens = Array.from(
            header.querySelectorAll(".sXJUrXQT .paragraphs-text-s"),
          )
            .map((node) => compactLabel(node.textContent || ""))
            .filter(Boolean);
          const contentType =
            contentMetaTokens.find((token) => token.includes("/")) || "";
          return { title, contentType };
        };

        const resolveAttachmentAutoExpand = (meta) => {
          const policy = attachmentExpansionPolicies.find((entry) => entry.when(meta));
          return policy ? policy.autoExpand : true;
        };

        const autoExpandAttachments = () => {
          document.querySelectorAll('[data-testid="test-result-attachment"]').forEach((attachment) => {
            if (attachment.dataset.autoExpanded === "1") return;
            const header = attachment.querySelector('[data-testid="test-result-attachment-header"]');
            if (!header) return;
            if (!attachment.dataset.sdxAutoExpand) {
              const meta = readAttachmentMeta(header);
              const policy = attachmentExpansionPolicies.find((entry) => entry.when(meta));
              attachment.dataset.sdxAutoExpandPolicy = policy?.id || "default";
              attachment.dataset.sdxAutoExpand = resolveAttachmentAutoExpand(meta) ? "1" : "0";
            }
            if (attachment.dataset.sdxAutoExpand === "0") {
              attachment.dataset.autoExpanded = "1";
              return;
            }
            const toggle = header.querySelector('button[class*="arrow-button"]');
            if (!toggle) return;
            const icon = toggle.querySelector("svg");
            const iconClass = classNameToString(icon?.className);
            const isExpanded = /opened/.test(iconClass);
            if (!isExpanded) {
              toggle.click();
            }
            attachment.dataset.autoExpanded = "1";
          });
        };

        const autoExpandTestSteps = () => {
          document
            .querySelectorAll('button[data-testid="test-result-step-arrow-button"]')
            .forEach((toggle) => {
              const row = toggle.closest('[data-testid="test-result-step"]');
              if (row?.dataset?.autoExpanded === "1") return;
              const icon = toggle.querySelector("svg");
              const iconClass = classNameToString(icon?.className);
              const isExpanded = /opened/.test(iconClass);
              if (!isExpanded) {
                toggle.click();
              }
              if (row) {
                row.dataset.autoExpanded = "1";
              }
            });
        };

        const autoSizeHtmlAttachmentFrames = () => {
          const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

          const resizeFrame = (frame) => {
            try {
              const doc = frame.contentDocument;
              if (!doc) return;
              const inDialog = !!frame.closest('[role="dialog"]');
              const min = 0;
              const max = inDialog
                ? Math.max(420, Math.floor(window.innerHeight * 0.9))
                : Math.max(220, Math.floor(window.innerHeight * 0.72));
              const root = doc.getElementById('allure-auto-size-root');
              const rootHeight = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
              const bodyHeight = doc.body ? doc.body.scrollHeight : 0;
              // Include body padding in the measured height so top/bottom spacing is preserved.
              const contentHeight = Math.max(rootHeight, bodyHeight, 0);
              if (contentHeight <= 0) return;
              const contentTarget = Math.max(min, contentHeight + 8);
              const previewTarget = clamp(contentTarget, min, max);
              const overflowNeeded = contentTarget > max;

              const preview = frame.closest('[class*="html-attachment-preview"]');
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
            } catch {
              // Cross-origin or transient iframe states should not break report interactivity.
            }
          };

          document
            .querySelectorAll('[data-testid="test-result-attachment"] [class*="html-attachment-preview"] iframe')
            .forEach((frame) => {
              if (frame.dataset.autoSizedAttached !== "1") {
                frame.addEventListener('load', () => resizeFrame(frame));
                frame.dataset.autoSizedAttached = "1";
              }
              resizeFrame(frame);
            });
        };

        const runPatches = () => {
          patchReportIcons();
          patchLastUpdatedLabel();
          hideThemeToggle();
          patchHomeButtonBehavior();
          patchBreadcrumbLinks();
          const autoExpandAttachmentsEnabled =
            typeof settings.autoExpandAttachmentsOverride === "boolean"
              ? settings.autoExpandAttachmentsOverride
              : resolveModeDefault(settings.expandMode);
          const autoExpandStepsEnabled =
            typeof settings.autoExpandStepsOverride === "boolean"
              ? settings.autoExpandStepsOverride
              : resolveModeDefault(settings.expandMode);

          if (autoExpandAttachmentsEnabled) {
            autoExpandAttachments();
          }
          if (autoExpandStepsEnabled) {
            autoExpandTestSteps();
          }
          autoSizeHtmlAttachmentFrames();
        };

        const observer = new MutationObserver(() => runPatches());
        observer.observe(document.documentElement, { childList: true, subtree: true });

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", runPatches);
        } else {
          runPatches();
        }
      })();
    </script>
    <style>
      :root,
      :root:not([data-theme=dark]),
      :root[data-theme=light] {
        --on-border-primary: rgba(5, 28, 73, 0.26);
        --on-border-muted: rgba(5, 28, 73, 0.14);
        --bg-base-secondary: #ddccba !important;
        --bg-base-neutral: #ddccba !important;
        --bg-base-primary: #fffaf3 !important;
      }

      body {
        background:
          radial-gradient(1200px 700px at 80% -20%, rgba(212, 115, 84, 0.24), rgba(246, 243, 238, 0)),
          radial-gradient(900px 540px at 5% 5%, rgba(204, 149, 70, 0.19), rgba(246, 243, 238, 0)),
          #ddccba !important;
      }

      html,
      body,
      #app,
      .P1qG0zXS,
      .q6NnC3sf,
      .s5e3ntNr,
      .X1bxR0kX {
        background-color: #ddccba !important;
      }

      #app,
      #app .X1bxR0kX,
      #app .q6NnC3sf,
      #app .s5e3ntNr,
      #app .OyL7dy7N,
      #app .t22uAI7s,
      #app .sgMxjSNq {
        --bg-base-secondary: #ddccba !important;
        --bg-base-neutral: #ddccba !important;
        --bg-base-primary: #fffaf3 !important;
        background-color: #ddccba !important;
      }

      div:has(> img[src*="${iconFileWithVersion}"]) {
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        padding: 0 !important;
      }

      img[src*="${iconFileWithVersion}"] {
        object-fit: contain !important;
      }

      .fma_u1MG svg,
      .fma_u1MG .styles_logo__jHlBl {
        display: none !important;
      }

      /* Keep dark mode disabled in branded report */
      button[aria-label*="theme" i],
      button[aria-label*="dark" i],
      button[aria-label*="light" i] {
        display: none !important;
      }

      .KayT_VKx .ChConoqG[role="link"] .vCHAp_yZ {
        text-decoration: underline;
        text-decoration-color: transparent;
        text-underline-offset: 2px;
      }

      .KayT_VKx .ChConoqG[role="link"]:hover .vCHAp_yZ,
      .KayT_VKx .ChConoqG[role="link"]:focus-visible .vCHAp_yZ {
        text-decoration-color: currentColor;
      }

      .KayT_VKx .ChConoqG[role="link"]:focus-visible {
        outline: 2px solid rgba(5, 28, 73, 0.35);
        outline-offset: 2px;
        border-radius: 4px;
      }

      /* Unify code block palette for markdown blocks and JSON attachment blocks */
      pre,
      pre code,
      pre[data-testid="code-attachment-content"],
      pre[data-testid="code-attachment-content"] code,
      pre[class*="language-"],
      pre[class*="language-"] code {
        background: #f6efe3 !important;
        color: #2f2a24 !important;
      }

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

      /* Fallback in case runtime patch hasn't executed yet */
      use[href="${LEGACY_ICON_ID}"],
      use[xlink\\:href="${LEGACY_ICON_ID}"] {
        display: none !important;
      }

      svg[data-brand-icon-patched="1"] {
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        min-height: 28px !important;
        background-size: 100% 100% !important;
      }
    </style>
${BRANDING_END}
`.trim();
}

function patchReportJs(reportDir) {
  const names = fs.readdirSync(reportDir);
  for (const fileName of names) {
    if (!/(^|\.)app-.*\.js$/.test(fileName)) continue;
    const filePath = path.join(reportDir, fileName);
    const raw = readUtf8(filePath);
    let patched = raw.replace(/"sections":\{"report":"Report"/g, '"sections":{"report":"SafeDocX"');

    // Allure Awesome renders HTML attachments as plain text inline by default.
    // Force inline preview mode for html/svg/image attachment kinds so rich rendering appears in step flow.
    const inlinePreviewNeedle =
      'children:V2(Rw,{item:e,i18n:{imageDiff:e=>i(`imageDiff.${e}`)}})';
    const inlinePreviewPatch =
      'children:V2(Rw,{item:e,previewable:"html"===s||"svg"===s||"image"===s,i18n:{imageDiff:e=>i(`imageDiff.${e}`)}})';
    if (patched.includes(inlinePreviewNeedle) && !patched.includes('previewable:"html"===s||"svg"===s||"image"===s')) {
      patched = patched.replace(inlinePreviewNeedle, inlinePreviewPatch);
    }

    // Ensure text/html attachments render as sanitized HTML (iframe preview),
    // even in call sites that do not set previewable=true.
    const htmlFallbackNeedle = 'const p=Nw[u];return p?Tc(p,{attachment:s.value,item:t,i18n:h}):null';
    const htmlFallbackPatch =
      'const p="html"===u&&Ow.html?Ow.html:Nw[u];return p?Tc(p,{attachment:s.value,item:t,i18n:h}):null';
    if (patched.includes(htmlFallbackNeedle) && !patched.includes('"html"===u&&Ow.html?Ow.html:Nw[u]')) {
      patched = patched.replace(htmlFallbackNeedle, htmlFallbackPatch);
    }

    // Allure Awesome sanitizes HTML attachment text before iframe preview.
    // For local branded reports we intentionally bypass this sanitizer so
    // iframe/data-uri/style based XML demos can render as-authored.
    const htmlSanitizeNeedle = 'i=r.length>0?(e=>Wy.sanitize(e,void 0))(r):""';
    const htmlSanitizePatch = 'i=r.length>0?r:""';
    if (patched.includes(htmlSanitizeNeedle) && !patched.includes(htmlSanitizePatch)) {
      patched = patched.replace(htmlSanitizeNeedle, htmlSanitizePatch);
    }

    // Allow links from HTML attachment previews to open new tabs/windows.
    const iframeSandboxNeedle = 'sandbox:"allow-same-origin"';
    const iframeSandboxPatch =
      'sandbox:"allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads"';
    if (patched.includes(iframeSandboxNeedle) && !patched.includes('allow-popups-to-escape-sandbox')) {
      patched = patched.replaceAll(iframeSandboxNeedle, iframeSandboxPatch);
    }

    if (patched !== raw) {
      writeUtf8(filePath, patched);
    }
  }
}

function patchReportIndex(reportDir, iconFileWithVersion) {
  const indexPath = path.join(reportDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing report index: ${indexPath}`);
  }

  let html = readUtf8(indexPath);
  html = upsertFaviconLinks(html, iconFileWithVersion);
  html = updateAllureOptions(html, iconFileWithVersion);
  html = stripBlock(html, BRANDING_START, BRANDING_END);
  html = stripLegacyManualBranding(html);

  const brandingBlock = makeBrandingBlock(iconFileWithVersion);
  if (!html.includes('</head>')) {
    throw new Error(`Invalid report index (missing </head>): ${indexPath}`);
  }
  html = html.replace('</head>', `${brandingBlock}\n</head>`);
  writeUtf8(indexPath, html);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Report directory not found: ${dirPath}`);
  }
}

function brandReport(reportDirArg) {
  const reportDir = path.resolve(ROOT, reportDirArg);
  ensureDir(reportDir);

  const iconBuffer = fs.readFileSync(ICON_SOURCE);
  const iconHash = crypto.createHash('sha1').update(iconBuffer).digest('hex').slice(0, 8);
  const iconFileName = 'safe-docx-mark.svg';
  const iconVersioned = `${iconFileName}?v=${iconHash}`;

  fs.copyFileSync(ICON_SOURCE, path.join(reportDir, iconFileName));
  patchReportIndex(reportDir, iconVersioned);
  patchReportJs(reportDir);
}

function main() {
  if (!fs.existsSync(ICON_SOURCE)) {
    throw new Error(`Missing icon asset: ${ICON_SOURCE}`);
  }

  const { reportDirs } = parseArgs(process.argv);
  for (const reportDir of reportDirs) {
    brandReport(reportDir);
    process.stdout.write(`Branded Allure report: ${reportDir}\n`);
  }
}

main();
