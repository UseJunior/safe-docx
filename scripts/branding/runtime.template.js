/*
 * SafeDocX Allure runtime branding template.
 * Tokens replaced by scripts/brand_allure_report.mjs:
 * - __ICON_URL_JSON__
 * - __LEGACY_ICON_ID_JSON__
 */
(() => {
        const ICON_URL = __ICON_URL_JSON__;
        const LEGACY_ICON_ID = __LEGACY_ICON_ID_JSON__;

        const patchSvgWithBrand = (svg) => {
          if (!svg) return;
          if (svg.dataset.brandIconPatched === "1") return;
          svg.dataset.brandIconPatched = "1";
          svg.style.background = `url("${ICON_URL}") center / contain no-repeat`;
          const useEl = svg.querySelector("use");
          if (useEl) {
            useEl.setAttribute("href", "#");
            useEl.setAttribute("xlink:href", "#");
            useEl.style.display = "none";
          }
        };

        const patchReportIcons = () => {
          const legacySelectors = [
            `use[href="${LEGACY_ICON_ID}"]`,
            `use[xlink\\:href="${LEGACY_ICON_ID}"]`,
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
              child.tagName === "SPAN" && /Ver:\s*\d+\.\d+\.\d+/.test(child.textContent || "")
            );
            if (!versionChild) return;
            const firstNode = el.childNodes[0];
            if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) return;
            const currentText = firstNode.textContent || "";
            if (/Last Updated:/.test(currentText)) {
              el.dataset.lastUpdatedPatched = "1";
              return;
            }
            firstNode.textContent = `Last Updated: ${currentText.trim()}`;
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

        const validatedTestResultIds = new Set();
        const staleHashChecksInFlight = new Set();

        const recoverFromStaleTestResultHash = async () => {
          const activeId = getActiveTestResultId();
          if (!activeId) return;
          if (validatedTestResultIds.has(activeId)) return;
          if (staleHashChecksInFlight.has(activeId)) return;

          staleHashChecksInFlight.add(activeId);
          try {
            const testResultPath = "data/test-results/" + activeId + ".json";
            let response = await fetch(testResultPath, {
              method: "HEAD",
              cache: "no-store",
            });
            if (response.status === 405 || response.status === 501) {
              response = await fetch(testResultPath, {
                cache: "no-store",
              });
            }

            if (!response.ok) {
              clearQueryParam();
              setSearchInputValueWithRetry("", 2);
              window.location.hash = "#/";
              return;
            }

            validatedTestResultIds.add(activeId);
          } catch {
            // Do not force navigation on transient network failures.
          } finally {
            staleHashChecksInFlight.delete(activeId);
          }
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

        const convertInlineHtmlToIframe = () => {
          document
            .querySelectorAll('[data-testid="test-result-attachment"]')
            .forEach((attachment) => {
              if (attachment.dataset.inlineHtmlConverted === "1") return;

              // Only process text/html attachments
              const header = attachment.querySelector('[data-testid="test-result-attachment-header"]');
              if (!header) return;
              const metaTokens = Array.from(
                header.querySelectorAll('.sXJUrXQT .paragraphs-text-s')
              ).map((node) => (node.textContent || '').trim()).filter(Boolean);
              const contentType = metaTokens.find((t) => t.includes('/')) || '';
              if (!/text\/html/i.test(contentType)) return;

              // Find the code block that contains raw HTML source
              const codePre = attachment.querySelector('pre[data-testid="code-attachment-content"]');
              if (!codePre) return;

              const rawHtml = codePre.textContent || '';
              if (!rawHtml.trim()) return;

              // Sanitize with DOMPurify if available; fail closed (keep code view) otherwise
              if (typeof DOMPurify === 'undefined' || typeof DOMPurify.sanitize !== 'function') return;
              const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
                WHOLE_DOCUMENT: true,
                ADD_TAGS: ['style', 'link'],
                ADD_ATTR: ['id', 'class', 'style'],
              });

              // Create sandboxed iframe — allow-same-origin without allow-scripts prevents execution
              const iframe = document.createElement('iframe');
              iframe.sandbox = 'allow-same-origin';
              iframe.style.width = '100%';
              iframe.style.border = '0';
              iframe.style.minHeight = '0';

              // Build the preview container
              const previewDiv = document.createElement('div');
              const parentClass = codePre.parentElement?.className || '';
              previewDiv.className = parentClass;
              if (!previewDiv.className.includes('html-attachment-preview')) {
                previewDiv.className = (previewDiv.className + ' html-attachment-preview').trim();
              }
              previewDiv.appendChild(iframe);

              // Replace the code block with the iframe preview
              const codeContainer = codePre.parentElement || codePre;
              codeContainer.parentElement?.replaceChild(previewDiv, codeContainer);

              // Write content into the iframe
              try {
                const doc = iframe.contentDocument;
                if (doc) {
                  doc.open();
                  doc.write(sanitizedHtml);
                  doc.close();
                }
              } catch {
                // Ignore write failures
              }

              attachment.dataset.inlineHtmlConverted = "1";
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

        const UI_PATCHES = [
          { id: "report-icons", run: patchReportIcons },
          { id: "last-updated-label", run: patchLastUpdatedLabel },
          { id: "hide-theme-toggle", run: hideThemeToggle },
          { id: "home-button-query-clear", run: patchHomeButtonBehavior },
          { id: "breadcrumb-links", run: patchBreadcrumbLinks },
          { id: "stale-hash-recovery", run: recoverFromStaleTestResultHash },
          { id: "inline-html-to-iframe", run: convertInlineHtmlToIframe },
        ];

        const runPatches = () => {
          UI_PATCHES.forEach((patch) => {
            try {
              patch.run();
            } catch {
              // Individual patch failures should not block the rest of the UI helpers.
            }
          });
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
