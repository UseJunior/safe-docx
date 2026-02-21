import { expect, it as vitestIt, test as vitestTest } from 'vitest';

const JSON_CONTENT_TYPE = 'application/json';
const TEXT_CONTENT_TYPE = 'text/plain';

export function getAllureRuntime() {
  return globalThis.allure;
}

function parseCurrentTestName() {
  const state = expect.getState();
  return (state.currentTestName ?? '')
    .split(' > ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeOpenSpecScenarioIds(values) {
  const flattened = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  const ids = flattened
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(ids)];
}

function normalizeTags(values) {
  const normalized = (values ?? [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(normalized)];
}

function mergeAllureDefaults(current, next) {
  const merged = { ...(current ?? {}), ...(next ?? {}) };

  if (current?.openspecScenarioIds || next?.openspecScenarioIds) {
    merged.openspecScenarioIds = normalizeOpenSpecScenarioIds([
      ...(current?.openspecScenarioIds ?? []),
      ...(next?.openspecScenarioIds ?? []),
    ]);
  }

  if (current?.tags || next?.tags) {
    merged.tags = normalizeTags([
      ...(current?.tags ?? []),
      ...(next?.tags ?? []),
    ]);
  }

  if (current?.parameters || next?.parameters) {
    merged.parameters = {
      ...(current?.parameters ?? {}),
      ...(next?.parameters ?? {}),
    };
  }

  return merged;
}

function resolveStoryLabel(explicitName, nameParts) {
  if (
    typeof explicitName === 'string'
    && explicitName.trim().length > 0
    && !/%[sdifjoO]/.test(explicitName)
  ) {
    return explicitName;
  }
  return nameParts.at(-1) ?? 'Unnamed test';
}

function extractScenarioId(story) {
  const match = story.trim().match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

export function createAllureTestHelpers(config) {
  const resolveEpic = config.resolveEpic ?? ((_feature, _fullName, defaults) => defaults?.epic ?? config.defaultEpic);

  async function applyAllureTags(allureRuntime, tags) {
    for (const tag of tags) {
      if (typeof allureRuntime.tags === 'function') {
        await allureRuntime.tags(tag);
        continue;
      }
      if (typeof allureRuntime.tag === 'function') {
        await allureRuntime.tag(tag);
        continue;
      }
      if (typeof allureRuntime.label === 'function') {
        await allureRuntime.label('tag', tag);
      }
    }
  }

  async function applyDefaultAllureLabels(defaults) {
    const allureRuntime = getAllureRuntime();
    if (!allureRuntime) {
      return;
    }

    const nameParts = parseCurrentTestName();
    const hierarchyParts = nameParts.slice(0, -1);
    const fullName = nameParts.join(' > ');
    const feature = defaults?.feature ?? hierarchyParts[0] ?? nameParts[0] ?? 'General';
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
    if (subSuite && typeof allureRuntime.subSuite === 'function') {
      await allureRuntime.subSuite(subSuite);
    }
    await allureRuntime.severity('normal');

    if (typeof defaults?.description === 'string' && defaults.description.length > 0 && typeof allureRuntime.description === 'function') {
      await allureRuntime.description(defaults.description);
    }

    if (defaults?.parameters && typeof allureRuntime.parameter === 'function') {
      for (const [key, value] of Object.entries(defaults.parameters)) {
        await allureRuntime.parameter(key, String(value));
      }
    }

    const tags = normalizeTags(defaults?.tags ?? []);
    if (tags.length > 0) {
      await applyAllureTags(allureRuntime, tags);
    }
  }

  function wrapWithAllure(fn, explicitName, defaults) {
    if (!fn) {
      return fn;
    }

    return (async (...args) => {
      await applyDefaultAllureLabels(defaults);

      const nameParts = parseCurrentTestName();
      const scenarioIds = defaults?.openspecScenarioIds ?? [];
      const storyLabels = scenarioIds.length > 0
        ? scenarioIds
        : [resolveStoryLabel(explicitName, nameParts)];

      const allureRuntime = getAllureRuntime();
      if (allureRuntime) {
        const scenarioSerials = new Set();
        for (const story of storyLabels) {
          await allureRuntime.story(story);
          const id = extractScenarioId(story);
          if (id) scenarioSerials.add(id);
        }
        if (scenarioSerials.size === 1 && typeof allureRuntime.id === 'function') {
          await allureRuntime.id([...scenarioSerials][0]);
        }
        if (typeof allureRuntime.label === 'function') {
          for (const id of scenarioSerials) {
            await allureRuntime.label('openspecScenarioId', id);
          }
        }
      }

      try {
        return await fn(...args);
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        await allureAttachment('execution-error.txt', message, TEXT_CONTENT_TYPE);
        throw error;
      }
    });
  }

  function withAllure(base, defaults) {
    const wrapped = ((name, fn, timeout) =>
      base(name, wrapWithAllure(fn, name, defaults), timeout));

    wrapped.only = (name, fn, timeout) =>
      base.only(name, wrapWithAllure(fn, name, defaults), timeout);
    wrapped.skip = base.skip.bind(base);
    wrapped.todo = base.todo.bind(base);
    wrapped.fails = (name, fn, timeout) =>
      base.fails(name, wrapWithAllure(fn, name, defaults), timeout);
    wrapped.concurrent = (name, fn, timeout) =>
      base.concurrent(name, wrapWithAllure(fn, name, defaults), timeout);

    wrapped.each = (...tableArgs) => {
      const eachBase = base.each(...tableArgs);
      return (name, fn, timeout) =>
        eachBase(name, wrapWithAllure(fn, name, defaults), timeout);
    };

    wrapped.withLabels = (nextDefaults) =>
      withAllure(base, mergeAllureDefaults(defaults, nextDefaults));
    wrapped.epic = (epic) =>
      withAllure(base, mergeAllureDefaults(defaults, { epic }));
    wrapped.openspec = (...scenarioIds) =>
      withAllure(base, mergeAllureDefaults(defaults, {
        openspecScenarioIds: normalizeOpenSpecScenarioIds(scenarioIds),
      }));
    wrapped.allure = (metadata) =>
      withAllure(base, mergeAllureDefaults(defaults, metadata));

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
    if (allureRuntime && typeof allureRuntime.parameter === 'function') {
      await allureRuntime.parameter(name, value);
    }
  }

  async function allureAttachment(name, content, contentType = TEXT_CONTENT_TYPE) {
    const allureRuntime = getAllureRuntime();
    if (allureRuntime && typeof allureRuntime.attachment === 'function') {
      await allureRuntime.attachment(name, content, contentType);
    }
  }

  async function allureJsonAttachment(name, payload) {
    const body = JSON.stringify(payload, null, 2);
    await allureAttachment(name, body, JSON_CONTENT_TYPE);
  }

  return {
    itAllure,
    testAllure,
    allureStep,
    allureParameter,
    allureAttachment,
    allureJsonAttachment,
    getAllureRuntime,
  };
}
