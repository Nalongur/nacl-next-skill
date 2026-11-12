#!/usr/bin/env node
/**
 * Shared page-contract tool for the S3 template and the distributable UI Skill.
 *
 * It is the single implementation for template composition, the layout/mode
 * matrix (including rejection cases), page inspection and generated-project
 * validation. The caller passes explicit paths so the same file works from
 * templates/s3 and from a copied skill distribution.
 *
 * Every command prints one JSON object and exits 0 when the command itself
 * ran; callers decide from `ok`/`errors`. Internal failures exit 1.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function output(value) {
  console.log(JSON.stringify(value));
}

function internalError(message, error) {
  output({
    ok: false,
    errors: [
      {
        path: "tool",
        code: "tool/internal",
        message: `${message}${error ? `：${error.message ?? error}` : ""}`,
      },
    ],
  });
  process.exit(1);
}

async function loadContract(starter) {
  const registryPath = path.join(starter, "src/contract/registry.mjs");
  const validationPath = path.join(starter, "src/validation/validate-page.mjs");
  const registry = await import(pathToFileURL(registryPath).href);
  const validation = await import(pathToFileURL(validationPath).href);
  return { registry, validation };
}

function templatePath(templatesDir, layout) {
  const file = path.join(templatesDir, `${layout}.json`);
  if (!fs.existsSync(file)) throw new Error(`缺少布局模板 ${file}`);
  return file;
}

function composedFor(validation, templatesDir, layout, mode) {
  return validation.composePage(readJson(templatePath(templatesDir, layout)), mode);
}

function byComponent(page, component) {
  const block = page.blocks.find((candidate) => candidate.component === component);
  if (!block) throw new Error(`fixture base is missing ${component}`);
  return block;
}

export async function runTemplateMatrix({ starter, templates, schema }) {
  const { registry, validation } = await loadContract(starter);
  const pageSchema = readJson(schema);
  const failures = [];
  const matrix = [];

  for (const layoutId of Object.keys(registry.LAYOUTS)) {
    const template = readJson(templatePath(templates, layoutId));
    for (const mode of registry.MODES) {
      const result = validation.validateTemplate({ template, pageSchema, mode });
      matrix.push({
        layout: layoutId,
        mode,
        ok: result.ok,
        blocks: result.ok ? validation.composePage(template, mode).blocks.length : 0,
        errors: result.errors,
      });
      if (!result.ok) {
        failures.push(`${layoutId}/${mode}: ${JSON.stringify(result.errors)}`);
      }
    }
  }

  const baseLayout = registry.LAYOUTS.sidebar ? "sidebar" : Object.keys(registry.LAYOUTS)[0];
  const base = composedFor(validation, templates, baseLayout, "b");
  const negativeCases = [
    {
      name: "unknown-component",
      mode: "b",
      expected: "page/unknown-component",
      mutate: (page) => {
        byComponent(page, "InstanceList").component = "MysteryPanel";
      },
    },
    {
      name: "unregistered-action",
      mode: "b",
      expected: "page/action-mismatch",
      mutate: (page) => {
        byComponent(page, "LaunchPanel").actions.start = "launch.begin";
      },
    },
    {
      name: "unsupported-version",
      mode: "b",
      expected: "page/schema-version",
      mutate: (page) => {
        page.schemaVersion = 2;
      },
    },
    {
      name: "illegal-param",
      mode: "b",
      expected: "page/unknown-param",
      mutate: (page) => {
        byComponent(page, "InstanceList").params.script = "alert(1)";
      },
    },
    {
      name: "missing-identity-component",
      mode: "b",
      expected: "page/missing-identity-component",
      mutate: (page) => {
        page.blocks = page.blocks.filter((block) => block.component !== "LocalProfiles");
      },
    },
    {
      name: "binding-mismatch",
      mode: "b",
      expected: "page/binding-mismatch",
      mutate: (page) => {
        byComponent(page, "InstanceList").bindings.items = "profiles.items";
      },
    },
    {
      name: "duplicate-component",
      mode: "b",
      expected: "page/duplicate-component",
      mutate: (page) => {
        const copy = structuredClone(byComponent(page, "InstanceList"));
        copy.id = "instances-copy";
        page.blocks.push(copy);
      },
    },
    {
      name: "component-slot",
      mode: "b",
      expected: "page/component-slot",
      mutate: (page) => {
        byComponent(page, "InstanceList").slot = "main";
      },
    },
    {
      name: "unknown-action-slot",
      mode: "b",
      expected: "page/unknown-action-slot",
      mutate: (page) => {
        byComponent(page, "LaunchPanel").actions.exec = "instances.create";
      },
    },
    {
      name: "mode-mismatch",
      mode: "d",
      expected: "page/mode-mismatch",
      mutate: () => {},
    },
  ];

  const negatives = [];
  for (const testCase of negativeCases) {
    const page = structuredClone(base);
    if (testCase.name !== "mode-mismatch") page.mode = testCase.mode;
    testCase.mutate(page);
    const result = validation.validatePage({
      page,
      project: {
        mode: testCase.mode,
        layout: page.layout,
        pageSchemaVersion: 1,
      },
      pageSchema,
      mode: testCase.mode,
    });
    const hit = result.errors.some((error) => error.code === testCase.expected);
    negatives.push({
      name: testCase.name,
      expected: testCase.expected,
      ok: !result.ok && hit,
      got: result.errors.map((error) => error.code),
    });
    if (result.ok || !hit) {
      failures.push(
        `${testCase.name}: expected ${testCase.expected}, got ${JSON.stringify(result.errors)}`,
      );
    }
  }

  const dPage = composedFor(validation, templates, baseLayout, "d");
  const dResult = validation.validatePage({
    page: dPage,
    project: { mode: "d", layout: dPage.layout, pageSchemaVersion: 1 },
    pageSchema,
    mode: "d",
  });
  if (!dResult.ok) failures.push(`D composition: ${JSON.stringify(dResult.errors)}`);

  return {
    ok: failures.length === 0,
    failures,
    matrix,
    negatives,
    dCoverage: {
      components: dPage.blocks.map((block) => block.component),
      ok: dResult.ok,
    },
  };
}

async function commandInspect(args) {
  const { registry, validation } = await loadContract(args.starter);
  const pageSchema = readJson(args.schema);
  const templates = {};
  for (const layoutId of Object.keys(registry.LAYOUTS)) {
    templates[layoutId] = {};
    for (const mode of registry.MODES) {
      const page = composedFor(validation, args.templates, layoutId, mode);
      const result = validation.validatePage({
        page,
        project: { mode, layout: layoutId, pageSchemaVersion: registry.PAGE_SCHEMA_VERSION },
        pageSchema,
        mode,
      });
      templates[layoutId][mode] = {
        ok: result.ok,
        title: page.title,
        blocks: page.blocks.map((block) => ({
          id: block.id,
          component: block.component,
          slot: block.slot,
          params: block.params ?? {},
        })),
        errors: result.errors,
      };
    }
  }
  output({
    ok: true,
    pageSchemaVersion: registry.PAGE_SCHEMA_VERSION,
    modes: registry.MODES,
    layouts: registry.LAYOUTS,
    identityRequirements: registry.IDENTITY_REQUIREMENTS,
    bindings: registry.BINDINGS,
    actions: registry.ACTIONS,
    components: registry.COMPONENTS,
    templates,
  });
}

async function commandCompose(args) {
  const { registry, validation } = await loadContract(args.starter);
  const pageSchema = readJson(args.schema);
  if (!registry.LAYOUTS[args.layout]) throw new Error(`未知布局 ${args.layout}`);
  if (!registry.MODES.includes(args.mode)) throw new Error(`未知模式 ${args.mode}`);
  const template = readJson(templatePath(args.templates, args.layout));
  const templateResult = validation.validateTemplate({ template, pageSchema, mode: args.mode });
  if (!templateResult.ok) {
    output({ ok: false, errors: templateResult.errors });
    return;
  }
  const page = validation.composePage(template, args.mode);
  if (args.title) page.title = args.title;
  const result = validation.validatePage({
    page,
    project: {
      mode: args.mode,
      layout: args.layout,
      pageSchemaVersion: registry.PAGE_SCHEMA_VERSION,
    },
    pageSchema,
    mode: args.mode,
  });
  output({ ok: result.ok, errors: result.errors, page });
}

async function commandValidateTemplates(args) {
  const summary = await runTemplateMatrix({
    starter: args.starter,
    templates: args.templates,
    schema: args.schema,
  });
  output(summary);
}

async function commandValidateProject(args) {
  const project = path.resolve(args.project);
  const validateModule = await import(
    `${pathToFileURL(path.join(project, "scripts/validate.mjs")).href}?run=${Date.now()}`
  );
  if (typeof validateModule.validateProjectDirectory !== "function") {
    throw new Error("工程 scripts/validate.mjs 缺少 validateProjectDirectory 导出");
  }
  const result = validateModule.validateProjectDirectory(project);
  output({ ok: result.errors.length === 0, ...result });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!command) throw new Error("缺少命令");
  if (command !== "validate-project") {
    for (const required of ["starter", "schema"]) {
      if (!args[required]) throw new Error(`缺少 --${required}`);
    }
  }
  if (["compose", "validate-templates", "inspect"].includes(command) && !args.templates) {
    throw new Error("缺少 --templates");
  }
  if (command === "inspect") return commandInspect(args);
  if (command === "compose") return commandCompose(args);
  if (command === "validate-templates") return commandValidateTemplates(args);
  if (command === "validate-project") {
    if (!args.project) throw new Error("缺少 --project");
    return commandValidateProject(args);
  }
  throw new Error(`未知命令 ${command}`);
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => internalError("页面工具执行失败", error));
}
