import fs from "node:fs";

import { parse } from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/types";

import { rejectedAliases, tagDefinitions, type NarrativeVisibility, type TagName } from "./tagSchema.js";

const KNOWN_NARRATIVE_KEYS = new Set<string>([
  ...Object.keys(tagDefinitions),
  ...rejectedAliases
]);

export type SourceRef = {
  path: string;
  line: number;
};

export type LiteralEvidence = {
  kind: "literal";
  value: unknown;
};

export type UnresolvedEvidence = {
  kind: "unresolved";
  sourceText: string;
  sourceRef: SourceRef;
};

export type EvidenceValue = LiteralEvidence | UnresolvedEvidence;

export type BddStepEvidence = {
  keyword: "given" | "when" | "then" | "and";
  value: EvidenceValue;
  sourceRef: SourceRef;
};

export type FixtureEvidence = {
  name: string;
  value: EvidenceValue;
  sourceRef: SourceRef;
};

export type ExpectArgEvidence = {
  value: EvidenceValue;
  sourceText: string;
  sourceRef: SourceRef;
};

export type ScenarioEvidence = {
  scenarioName: string;
  sourceRef: SourceRef;
  visibility?: NarrativeVisibility;
  narrative: Partial<Record<TagName, string>>;
  bddSteps: BddStepEvidence[];
  fixtures: FixtureEvidence[];
  expectArgs: ExpectArgEvidence[];
};

type VariableBindings = Map<string, TSESTree.Expression>;

const BDD_STEP_NAMES = new Set(["given", "when", "then", "and"]);
const VISIBILITY_METHODS = new Set(["withLabels", "allure"]);

const hasRange = (node: TSESTree.Node): node is TSESTree.Node & { range: TSESTree.Range } =>
  Array.isArray(node.range);

const hasCommentRange = (comment: TSESTree.Comment): comment is TSESTree.Comment & { range: TSESTree.Range } =>
  Array.isArray(comment.range);

const sourceRefFor = (filePath: string, node: TSESTree.Node): SourceRef => ({
  path: filePath,
  line: node.loc?.start.line ?? 1
});

const sourceTextFor = (source: string, node: TSESTree.Node): string => {
  if (!hasRange(node)) return "";
  return source.slice(node.range[0], node.range[1]);
};

function parseSource(filePath: string): { source: string; ast: TSESTree.Program } {
  const source = fs.readFileSync(filePath, "utf8");
  const ast = parse(source, {
    loc: true,
    range: true,
    comment: true,
    jsx: false
  }) as TSESTree.Program;
  return { source, ast };
}

function getPropertyName(node: TSESTree.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }
  return undefined;
}

function findOpeningOpenspecCall(callee: TSESTree.Expression): TSESTree.CallExpression | undefined {
  if (callee.type !== "CallExpression") return undefined;
  if (callee.callee.type === "MemberExpression" && getPropertyName(callee.callee) === "openspec") {
    return callee;
  }
  if (callee.callee.type === "CallExpression") {
    return findOpeningOpenspecCall(callee.callee);
  }
  return undefined;
}

function isScenarioCall(node: TSESTree.CallExpression): boolean {
  // The scenario call is the OUTERMOST chained call in a pattern like
  //   test.openspec(...)(...metadata)(scenarioName, scenarioBody)
  // Its signature is: first arg is a string-shaped literal (the scenario
  // name), second arg is a function (the scenario body). Intermediate
  // metadata-shaped calls in the chain (e.g., test.openspec(id)({ visibility }))
  // are NOT scenarios — they configure subsequent calls — and must not be
  // extracted as phantom scenarios.
  if (findOpeningOpenspecCall(node.callee) === undefined) return false;
  if (node.arguments.length < 2) return false;
  const firstArg = expressionFromArgument(node.arguments[0]);
  if (!firstArg) return false;
  const firstArgLiteral = literalFromExpression(firstArg);
  if (typeof firstArgLiteral !== "string") return false;
  const secondArg = expressionFromArgument(node.arguments[1]);
  if (!secondArg) return false;
  if (secondArg.type !== "ArrowFunctionExpression" && secondArg.type !== "FunctionExpression") {
    return false;
  }
  return true;
}

function expressionFromArgument(argument: TSESTree.CallExpressionArgument | undefined): TSESTree.Expression | undefined {
  if (!argument) return undefined;
  if (argument.type === "SpreadElement") return undefined;
  return argument;
}

function literalFromExpression(expression: TSESTree.Expression): unknown | undefined {
  if (expression.type === "Literal") return expression.value;
  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? "";
  }
  if (expression.type === "ArrayExpression") {
    const values: unknown[] = [];
    for (const element of expression.elements) {
      if (!element || element.type === "SpreadElement") return undefined;
      const value = literalFromExpression(element);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  if (expression.type === "ObjectExpression") {
    const value: Record<string, unknown> = {};
    for (const property of expression.properties) {
      if (property.type === "SpreadElement" || property.computed || property.kind !== "init") return undefined;
      const key =
        property.key.type === "Identifier"
          ? property.key.name
          : property.key.type === "Literal" && typeof property.key.value === "string"
            ? property.key.value
            : undefined;
      if (key === undefined) return undefined;
      const propertyValue = literalFromExpression(property.value as TSESTree.Expression);
      if (propertyValue === undefined) return undefined;
      value[key] = propertyValue;
    }
    return value;
  }
  return undefined;
}

function collectBodyBindings(body: TSESTree.Node): VariableBindings {
  const bindings: VariableBindings = new Map();
  walk(body, (node) => {
    if (node.type !== "VariableDeclarator") return;
    if (node.id.type !== "Identifier" || !node.init) return;
    bindings.set(node.id.name, node.init);
  });
  return bindings;
}

function evidenceForExpression(
  expression: TSESTree.Expression,
  bindings: VariableBindings,
  filePath: string,
  source: string
): EvidenceValue {
  const literal = literalFromExpression(expression);
  if (literal !== undefined) return { kind: "literal", value: literal };

  if (expression.type === "Identifier") {
    const binding = bindings.get(expression.name);
    if (binding) {
      const bindingLiteral = literalFromExpression(binding);
      if (bindingLiteral !== undefined) return { kind: "literal", value: bindingLiteral };
    }
  }

  return {
    kind: "unresolved",
    sourceText: sourceTextFor(source, expression),
    sourceRef: sourceRefFor(filePath, expression)
  };
}

function extractNarrative(commentValue: string | undefined): Partial<Record<TagName, string>> {
  const narrative: Record<string, string> = {};
  if (!commentValue) return narrative;

  let currentTag: string | undefined;
  let currentLines: string[] = [];
  const flush = () => {
    if (!currentTag) return;
    // Only emit tags that the schema cares about. Unknown JSDoc tags
    // (@see, @example, @deprecated, etc.) are part of normal TS convention
    // and must not poison validation. Known-but-rejected aliases stay so the
    // downstream validator can produce an explicit "this alias is forbidden"
    // error rather than silently dropping it.
    if (KNOWN_NARRATIVE_KEYS.has(currentTag)) {
      narrative[currentTag] = currentLines.join(" ").replace(/\s+/g, " ").trim();
    }
  };

  for (const rawLine of commentValue.split("\n")) {
    const line = rawLine.replace(/^\s*\* ?/, "").trimEnd();
    const tagMatch = line.match(/^@([A-Za-z][\w-]*)\s*(.*)$/);
    if (tagMatch) {
      flush();
      currentTag = tagMatch[1];
      currentLines = [tagMatch[2] ?? ""];
      continue;
    }
    if (currentTag) currentLines.push(line.trim());
  }
  flush();

  return narrative;
}

function findLeadingJsDoc(
  ast: TSESTree.Program,
  source: string,
  node: TSESTree.Node
): TSESTree.Comment | undefined {
  if (!hasRange(node)) return undefined;
  const comments = (ast.comments ?? [])
    .filter((comment) => comment.type === "Block" && comment.value.startsWith("*"))
    .filter((comment) => hasCommentRange(comment) && comment.range[1] <= node.range[0])
    .sort((a, b) => b.range[1] - a.range[1]);

  for (const comment of comments) {
    if (!hasCommentRange(comment)) continue;
    const gap = source.slice(comment.range[1], node.range[0]);
    if (/^\s*$/.test(gap)) return comment;
    break;
  }
  return undefined;
}

function collectFileBindings(ast: TSESTree.Program): VariableBindings {
  const bindings: VariableBindings = new Map();
  for (const statement of ast.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type === "Identifier" && declaration.init) {
        bindings.set(declaration.id.name, declaration.init);
      }
    }
  }
  return bindings;
}

function visibilityFromObjectExpression(expression: TSESTree.Expression): NarrativeVisibility | undefined {
  if (expression.type !== "ObjectExpression") return undefined;
  for (const property of expression.properties) {
    if (property.type === "SpreadElement" || property.computed || property.kind !== "init") continue;
    const key =
      property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "Literal" && typeof property.key.value === "string"
          ? property.key.value
          : undefined;
    if (key !== "visibility") continue;
    if (
      property.value.type === "Literal" &&
      (property.value.value === "public" || property.value.value === "internal")
    ) {
      return property.value.value;
    }
  }
  return undefined;
}

function visibilityFromExpression(
  expression: TSESTree.Expression | undefined,
  fileBindings: VariableBindings,
  seen = new Set<string>()
): NarrativeVisibility | undefined {
  if (!expression) return undefined;

  if (expression.type === "Identifier") {
    if (seen.has(expression.name)) return undefined;
    seen.add(expression.name);
    return visibilityFromExpression(fileBindings.get(expression.name), fileBindings, seen);
  }

  if (expression.type !== "CallExpression") return undefined;

  let visibility: NarrativeVisibility | undefined;
  if (expression.callee.type === "MemberExpression") {
    const method = getPropertyName(expression.callee);
    if (method && VISIBILITY_METHODS.has(method)) {
      visibility = visibilityFromObjectExpression(expressionFromArgument(expression.arguments[0]) as TSESTree.Expression);
    }
    return visibility ?? visibilityFromExpression(expression.callee.object as TSESTree.Expression, fileBindings, seen);
  }

  if (expression.callee.type === "CallExpression") {
    return visibilityFromExpression(expression.callee, fileBindings, seen);
  }

  return undefined;
}

function visibilityForScenarioCall(
  scenarioCall: TSESTree.CallExpression,
  openspecCall: TSESTree.CallExpression,
  fileBindings: VariableBindings
): NarrativeVisibility | undefined {
  if (scenarioCall.callee.type === "CallExpression") {
    const metadataVisibility = visibilityFromObjectExpression(
      expressionFromArgument(scenarioCall.callee.arguments[0]) as TSESTree.Expression
    );
    if (metadataVisibility) return metadataVisibility;
  }

  const directVisibility = visibilityFromExpression(scenarioCall.callee, fileBindings);
  if (directVisibility) return directVisibility;
  if (openspecCall.callee.type === "MemberExpression") {
    return visibilityFromExpression(openspecCall.callee.object as TSESTree.Expression, fileBindings);
  }
  return undefined;
}

function extractScenarioName(call: TSESTree.CallExpression, source: string): string {
  const nameArg = expressionFromArgument(call.arguments[0]);
  if (!nameArg) return "";
  const literal = literalFromExpression(nameArg);
  return typeof literal === "string" ? literal : sourceTextFor(source, nameArg);
}

function collectScenarioBody(call: TSESTree.CallExpression): TSESTree.Node | undefined {
  const bodyArg = expressionFromArgument(call.arguments[1]);
  if (!bodyArg) return undefined;
  if (bodyArg.type === "ArrowFunctionExpression" || bodyArg.type === "FunctionExpression") {
    return bodyArg.body;
  }
  return undefined;
}

function extractBodyEvidence(
  body: TSESTree.Node | undefined,
  filePath: string,
  source: string
): Pick<ScenarioEvidence, "bddSteps" | "fixtures" | "expectArgs"> {
  const bddSteps: BddStepEvidence[] = [];
  const fixtures: FixtureEvidence[] = [];
  const expectArgs: ExpectArgEvidence[] = [];
  if (!body) return { bddSteps, fixtures, expectArgs };

  const bindings = collectBodyBindings(body);
  for (const [name, init] of bindings.entries()) {
    fixtures.push({
      name,
      value: evidenceForExpression(init, bindings, filePath, source),
      sourceRef: sourceRefFor(filePath, init)
    });
  }

  walk(body, (node) => {
    if (node.type !== "CallExpression") return;
    const calleeName =
      node.callee.type === "Identifier"
        ? node.callee.name
        : node.callee.type === "MemberExpression"
          ? getPropertyName(node.callee)
          : undefined;
    if (!calleeName) return;

    if (BDD_STEP_NAMES.has(calleeName)) {
      const firstArg = expressionFromArgument(node.arguments[0]);
      if (!firstArg) return;
      bddSteps.push({
        keyword: calleeName as BddStepEvidence["keyword"],
        value: evidenceForExpression(firstArg, bindings, filePath, source),
        sourceRef: sourceRefFor(filePath, node)
      });
      return;
    }

    if (calleeName === "expect") {
      const firstArg = expressionFromArgument(node.arguments[0]);
      if (!firstArg) return;
      expectArgs.push({
        value: evidenceForExpression(firstArg, bindings, filePath, source),
        sourceText: sourceTextFor(source, firstArg),
        sourceRef: sourceRefFor(filePath, node)
      });
    }
  });

  return { bddSteps, fixtures, expectArgs };
}

export function extractScenarios(filePath: string): ScenarioEvidence[] {
  const { source, ast } = parseSource(filePath);
  const fileBindings = collectFileBindings(ast);
  const scenarios: ScenarioEvidence[] = [];

  walk(ast, (node) => {
    if (node.type !== "CallExpression" || !isScenarioCall(node)) return;
    const openspecCall = findOpeningOpenspecCall(node.callee);
    if (!openspecCall) return;

    const comment = findLeadingJsDoc(ast, source, node);
    const body = collectScenarioBody(node);
    const evidence = extractBodyEvidence(body, filePath, source);
    scenarios.push({
      scenarioName: extractScenarioName(node, source),
      sourceRef: sourceRefFor(filePath, node),
      visibility: visibilityForScenarioCall(node, openspecCall, fileBindings),
      narrative: extractNarrative(comment?.value),
      ...evidence
    });
  });

  return scenarios;
}

function walk(node: TSESTree.Node, visit: (node: TSESTree.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node) as Array<keyof typeof node>) {
    if (key === "parent" || key === "range" || key === "loc") continue;
    const value = node[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) walk(item as TSESTree.Node, visit);
      }
    } else if (typeof value === "object" && "type" in value) {
      walk(value as TSESTree.Node, visit);
    }
  }
}
