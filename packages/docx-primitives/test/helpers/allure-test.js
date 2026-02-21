import { expect, it as vitestIt, test as vitestTest } from "vitest";
function getAllureRuntime() {
  return globalThis.allure;
}
const DEFAULT_EPIC = "DOCX Primitives";
const JSON_CONTENT_TYPE = "application/json";
const TEXT_CONTENT_TYPE = "text/plain";
function parseCurrentTestName() {
  const state = expect.getState();
  return (state.currentTestName ?? "").split(" > ").map((part) => part.trim()).filter(Boolean);
}
function resolveEpic(feature, fullName, defaults) {
  void feature;
  void fullName;
  if (defaults?.epic) {
    return defaults.epic;
  }
  return DEFAULT_EPIC;
}
async function applyDefaultAllureLabels(defaults) {
  const allureRuntime = getAllureRuntime();
  if (!allureRuntime) {
    return;
  }
  const nameParts = parseCurrentTestName();
  const hierarchyParts = nameParts.slice(0, -1);
  const fullName = nameParts.join(" > ");
  const feature = defaults?.feature ?? hierarchyParts[0] ?? nameParts[0] ?? "General";
  const suite = defaults?.suite ?? hierarchyParts[1];
  const subSuite = defaults?.subSuite ?? hierarchyParts[2];
  const epic = resolveEpic(feature, fullName, defaults);
  const parentSuite = defaults?.parentSuite ?? epic;
  await allureRuntime.epic(epic);
  await allureRuntime.feature(feature);
  await allureRuntime.parentSuite(parentSuite);
  if (suite) {
    await allureRuntime.suite(suite);
  }
  if (subSuite && typeof allureRuntime.subSuite === "function") {
    await allureRuntime.subSuite(subSuite);
  }
  await allureRuntime.severity("normal");
}
function resolveStoryLabel(explicitName, nameParts) {
  if (typeof explicitName === "string" && explicitName.trim().length > 0 && !/%[sdifjoO]/.test(explicitName)) {
    return explicitName;
  }
  return nameParts.at(-1) ?? "Unnamed test";
}
function normalizeOpenSpecScenarioIds(values) {
  const flattened = values.flatMap((value) => Array.isArray(value) ? value : [value]);
  const ids = flattened.filter((value) => typeof value === "string").map((value) => value.trim()).filter((value) => value.length > 0);
  return [...new Set(ids)];
}
function extractScenarioId(story) {
  const match = story.trim().match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : null;
}
function wrapWithAllure(fn, explicitName, defaults) {
  if (!fn) {
    return fn;
  }
  const run = fn;
  return (async (...args) => {
    await applyDefaultAllureLabels(defaults);
    const nameParts = parseCurrentTestName();
    const scenarioIds = defaults?.openspecScenarioIds ?? [];
    const storyLabels = scenarioIds.length > 0 ? scenarioIds : [resolveStoryLabel(explicitName, nameParts)];
    const allureRuntime = getAllureRuntime();
    if (allureRuntime) {
      const scenarioSerials = /* @__PURE__ */ new Set();
      for (const story of storyLabels) {
        await allureRuntime.story(story);
        const id = extractScenarioId(story);
        if (id) scenarioSerials.add(id);
      }
      if (scenarioSerials.size === 1 && typeof allureRuntime.id === "function") {
        await allureRuntime.id([...scenarioSerials][0]);
      }
      if (typeof allureRuntime.label === "function") {
        for (const id of scenarioSerials) {
          await allureRuntime.label("openspecScenarioId", id);
        }
      }
    }
    try {
      return await run(...args);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await allureAttachment("execution-error.txt", message, TEXT_CONTENT_TYPE);
      throw error;
    }
  });
}
function withAllure(base, defaults) {
  const wrapped = ((name, fn, timeout) => base(name, wrapWithAllure(fn, name, defaults), timeout));
  wrapped.only = (name, fn, timeout) => base.only(name, wrapWithAllure(fn, name, defaults), timeout);
  wrapped.skip = base.skip.bind(base);
  wrapped.todo = base.todo.bind(base);
  wrapped.fails = (name, fn, timeout) => base.fails(name, wrapWithAllure(fn, name, defaults), timeout);
  wrapped.concurrent = (name, fn, timeout) => base.concurrent(name, wrapWithAllure(fn, name, defaults), timeout);
  wrapped.each = (...tableArgs) => {
    const eachBase = base.each(...tableArgs);
    return (name, fn, timeout) => eachBase(name, wrapWithAllure(fn, name, defaults), timeout);
  };
  wrapped.withLabels = (nextDefaults) => withAllure(base, { ...defaults, ...nextDefaults });
  wrapped.epic = (epic) => withAllure(base, { ...defaults, epic });
  wrapped.openspec = (...scenarioIds) => withAllure(base, {
    ...defaults,
    openspecScenarioIds: normalizeOpenSpecScenarioIds(scenarioIds)
  });
  return wrapped;
}
const itAllure = withAllure(vitestIt);
const testAllure = withAllure(vitestTest);
async function allureStep(name, run) {
  const allureRuntime = getAllureRuntime();
  if (allureRuntime) {
    return allureRuntime.step(name, run);
  }
  return run();
}
async function allureParameter(name, value) {
  const allureRuntime = getAllureRuntime();
  if (allureRuntime && typeof allureRuntime.parameter === "function") {
    await allureRuntime.parameter(name, value);
  }
}
async function allureAttachment(name, content, contentType = TEXT_CONTENT_TYPE) {
  const allureRuntime = getAllureRuntime();
  if (allureRuntime && typeof allureRuntime.attachment === "function") {
    await allureRuntime.attachment(name, content, contentType);
  }
}
async function allureJsonAttachment(name, payload) {
  const body = JSON.stringify(payload, null, 2);
  await allureAttachment(name, body, JSON_CONTENT_TYPE);
}
export {
  allureAttachment,
  allureJsonAttachment,
  allureParameter,
  allureStep,
  getAllureRuntime,
  itAllure,
  testAllure
};
