/**
 * Two-gate page validation.
 *
 * 1. JSON Schema: field presence, types, enums, patterns, unknown keys.
 * 2. Semantic: registered layout/component/slot, data bindings, actions,
 *    required capability for the project mode, and required core surface.
 *
 * The function returns stable `code` values plus a JSON path for diagnostics.
 * It never mutates or repairs the input.
 */

import {
  ACTIONS,
  BINDINGS,
  COMPONENTS,
  IDENTITY_REQUIREMENTS,
  LAYOUTS,
  MODES,
  PAGE_SCHEMA_VERSION,
  actionAllowedInMode,
  bindingAllowedInMode,
  componentAllowedInMode,
} from "../contract/registry.mjs";
import validatePageStructure from "./generated/page-validator.mjs";
import validateProjectStructure from "./generated/project-validator.mjs";

function structuralValidator(schema) {
  // The generated validators are compiled from the same schema files by
  // scripts/build-validators.mjs (CSP forbids runtime code generation).
  if (schema && typeof schema.$id === "string" && schema.$id.includes("project")) {
    return validateProjectStructure;
  }
  return validatePageStructure;
}

function schemaErrors(schema, value, root) {
  const validate = structuralValidator(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => {
    const missing = error.params && error.params.missingProperty;
    const extra = error.params && error.params.additionalProperty;
    const suffix = missing ? `/${missing}` : extra ? `/${extra}` : "";
    return {
      path: `${root}${error.instancePath ?? ""}${suffix}`,
      code: `schema/${error.keyword}`,
      message: error.message ?? "JSON Schema validation failed",
    };
  });
}

function issue(path, code, message) {
  return { path, code, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkParams(block, definition, index, errors) {
  if (block.params !== undefined && !isPlainObject(block.params)) {
    errors.push(issue(`page.blocks[${index}].params`, "page/invalid-params", "params 必须是对象"));
    return;
  }
  for (const [key, value] of Object.entries(block.params ?? {})) {
    const spec = definition.params[key];
    if (!spec) {
      errors.push(
        issue(
          `page.blocks[${index}].params.${key}`,
          "page/unknown-param",
          `组件 ${block.component} 不支持参数 ${key}`,
        ),
      );
      continue;
    }
    if (spec.type === "boolean" && typeof value !== "boolean") {
      errors.push(
        issue(`page.blocks[${index}].params.${key}`, "page/invalid-param", `${key} 必须是布尔值`),
      );
    } else if (spec.type === "integer") {
      if (!Number.isInteger(value)) {
        errors.push(
          issue(`page.blocks[${index}].params.${key}`, "page/invalid-param", `${key} 必须是整数`),
        );
      } else if (
        (spec.min !== undefined && value < spec.min) ||
        (spec.max !== undefined && value > spec.max)
      ) {
        errors.push(
          issue(
            `page.blocks[${index}].params.${key}`,
            "page/invalid-param",
            `${key} 超出允许范围 ${spec.min}..${spec.max}`,
          ),
        );
      }
    } else if (spec.type === "enum" && !spec.values.includes(value)) {
      errors.push(
        issue(
          `page.blocks[${index}].params.${key}`,
          "page/invalid-param",
          `${key} 必须是 ${spec.values.join(" / ")} 之一`,
        ),
      );
    }
  }
}

function checkBindings(block, definition, index, mode, errors) {
  const provided = block.bindings ?? {};
  for (const required of definition.requiredBindings) {
    if (!(required in provided)) {
      errors.push(
        issue(
          `page.blocks[${index}].bindings.${required}`,
          "page/missing-binding",
          `组件 ${block.component} 需要绑定 ${required}`,
        ),
      );
    }
  }
  for (const [key, path] of Object.entries(provided)) {
    const expected = definition.bindings[key];
    if (!expected) {
      errors.push(
        issue(
          `page.blocks[${index}].bindings.${key}`,
          "page/unknown-binding",
          `组件 ${block.component} 没有绑定 ${key}`,
        ),
      );
      continue;
    }
    if (path !== expected) {
      errors.push(
        issue(
          `page.blocks[${index}].bindings.${key}`,
          "page/binding-mismatch",
          `${key} 只能绑定 ${expected}`,
        ),
      );
      continue;
    }
    if (!BINDINGS[path]) {
      errors.push(
        issue(`page.blocks[${index}].bindings.${key}`, "page/unknown-binding-path", `未注册数据源 ${path}`),
      );
    } else if (!bindingAllowedInMode(mode, path)) {
      errors.push(
        issue(
          `page.blocks[${index}].bindings.${key}`,
          "page/binding-unavailable",
          `模式 ${mode.toUpperCase()} 不提供数据源 ${path}`,
        ),
      );
    }
  }
}

function checkActions(block, definition, index, mode, errors) {
  const provided = block.actions ?? {};
  for (const required of definition.requiredActions) {
    if (!(required in provided)) {
      errors.push(
        issue(
          `page.blocks[${index}].actions.${required}`,
          "page/missing-action",
          `组件 ${block.component} 需要动作 ${required}`,
        ),
      );
    }
  }
  for (const [key, actionId] of Object.entries(provided)) {
    const expected = definition.actions[key];
    if (!expected) {
      errors.push(
        issue(
          `page.blocks[${index}].actions.${key}`,
          "page/unknown-action-slot",
          `组件 ${block.component} 没有动作入口 ${key}`,
        ),
      );
      continue;
    }
    if (actionId !== expected) {
      errors.push(
        issue(
          `page.blocks[${index}].actions.${key}`,
          "page/action-mismatch",
          `${key} 只能绑定动作 ${expected}`,
        ),
      );
      continue;
    }
    if (!ACTIONS[actionId]) {
      errors.push(
        issue(
          `page.blocks[${index}].actions.${key}`,
          "page/unknown-action",
          `未注册动作 ${actionId}`,
        ),
      );
    } else if (!actionAllowedInMode(mode, actionId)) {
      errors.push(
        issue(
          `page.blocks[${index}].actions.${key}`,
          "page/action-unavailable",
          `模式 ${mode.toUpperCase()} 不提供动作 ${actionId}`,
        ),
      );
    }
  }
}

/**
 * @param {object} input
 * @param {object} input.page
 * @param {object} input.project
 * @param {object} input.pageSchema
 * @param {"a"|"b"|"d"} input.mode
 * @returns {{ok: boolean, errors: Array<{path: string, code: string, message: string}>}}
 */
export function validatePage({ page, project, pageSchema, mode }) {
  const errors = [...schemaErrors(pageSchema, page, "page")];
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 40) };

  if (!MODES.includes(mode)) {
    return { ok: false, errors: [issue("page.mode", "page/unsupported-mode", `未知模式 ${mode}`)] };
  }
  if (page.schemaVersion !== PAGE_SCHEMA_VERSION) {
    errors.push(
      issue(
        "page.schemaVersion",
        "page/schema-version",
        `页面 schema 版本 ${page.schemaVersion} 不受支持（需要 ${PAGE_SCHEMA_VERSION}）`,
      ),
    );
  }
  if (page.mode !== mode) {
    errors.push(
      issue(
        "page.mode",
        "page/mode-mismatch",
        `页面为模式 ${String(page.mode).toUpperCase()}，当前构建为 ${mode.toUpperCase()}`,
      ),
    );
  }
  if (!project || project.mode !== mode) {
    errors.push(
      issue(
        "project.mode",
        "project/mode-mismatch",
        `项目配置模式 ${project?.mode ?? "缺失"} 与构建 ${mode.toUpperCase()} 不一致`,
      ),
    );
  }
  if (project && project.layout !== page.layout) {
    errors.push(
      issue(
        "project.layout",
        "project/layout-mismatch",
        `项目配置布局 ${project.layout} 与页面布局 ${page.layout} 不一致`,
      ),
    );
  }
  if (project && project.pageSchemaVersion !== page.schemaVersion) {
    errors.push(
      issue(
        "project.pageSchemaVersion",
        "project/page-schema-version",
        "项目配置与页面的 schema 版本不一致",
      ),
    );
  }

  const layout = LAYOUTS[page.layout];
  if (!layout) {
    errors.push(issue("page.layout", "page/unknown-layout", `未注册布局 ${page.layout}`));
    return { ok: false, errors: errors.slice(0, 40) };
  }

  if (page.layout === "nacl" && page.navigationVersion !== 1) errors.push(issue("page.navigationVersion", "page/invalid-page", "nacl 导航版本必须为 1"));
  if (page.layout !== "nacl" && page.navigationVersion !== undefined) errors.push(issue("page.navigationVersion", "page/invalid-page", "其他布局不支持导航版本"));
  const blockIds = new Set();
  const components = new Set();
  page.blocks.forEach((block, index) => {
    const base = `page.blocks[${index}]`;
    if (page.layout !== "nacl" && block.page !== undefined) errors.push(issue(`${base}.page`, "page/invalid-page", "页面归属仅支持 nacl 布局"));
    if (page.layout === "nacl" && block.page === undefined) errors.push(issue(`${base}.page`, "page/invalid-page", "nacl 区块必须指定页面"));
    if (blockIds.has(block.id)) {
      errors.push(issue(`${base}.id`, "page/duplicate-block", `重复区块标识 ${block.id}`));
    }
    blockIds.add(block.id);
    if (!layout.slots.includes(block.slot)) {
      errors.push(
        issue(
          `${base}.slot`,
          "page/unknown-slot",
          `布局 ${page.layout} 没有区域 ${block.slot}`,
        ),
      );
    }
    const definition = COMPONENTS[block.component];
    if (!definition) {
      errors.push(
        issue(`${base}.component`, "page/unknown-component", `未注册组件 ${block.component}`),
      );
      return;
    }
    if (!componentAllowedInMode(mode, block.component)) {
      errors.push(
        issue(
          `${base}.component`,
          "page/component-unavailable",
          `模式 ${mode.toUpperCase()} 不提供组件 ${block.component}`,
        ),
      );
    }
    if (!definition.slots.includes(block.slot)) {
      errors.push(
        issue(
          `${base}.slot`,
          "page/component-slot",
          `组件 ${block.component} 不能放入区域 ${block.slot}`,
        ),
      );
    }
    if (components.has(block.component)) {
      errors.push(
        issue(`${base}.component`, "page/duplicate-component", `组件 ${block.component} 只能出现一次`),
      );
    }
    components.add(block.component);
    checkBindings(block, definition, index, mode, errors);
    checkActions(block, definition, index, mode, errors);
    checkParams(block, definition, index, errors);
  });

  for (const required of layout.requiredComponents) {
    if (!components.has(required)) {
      errors.push(
        issue("page.blocks", "page/missing-core-component", `布局 ${page.layout} 缺少核心组件 ${required}`),
      );
    }
  }
  for (const required of IDENTITY_REQUIREMENTS[mode]) {
    if (!components.has(required)) {
      errors.push(
        issue(
          "page.blocks",
          "page/missing-identity-component",
          `模式 ${mode.toUpperCase()} 需要身份组件 ${required}`,
        ),
      );
    }
  }
  for (const component of components) {
    const definition = COMPONENTS[component];
    if (definition && !definition.modes.includes(mode)) {
      errors.push(
        issue("page.blocks", "page/identity-component-unavailable", `${component} 不属于模式 ${mode.toUpperCase()}`),
      );
    }
  }

  return { ok: errors.length === 0, errors: errors.slice(0, 40) };
}

/**
 * Validates a generated project config and its page together. Structural
 * checks run first; cross-file mode/layout/version consistency follows.
 */
export function validateProject({ project, page, projectSchema, pageSchema }) {
  const errors = [...schemaErrors(projectSchema, project, "project")];
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 40) };
  if (project.pageSchemaVersion !== PAGE_SCHEMA_VERSION) {
    errors.push(
      issue(
        "project.pageSchemaVersion",
        "project/page-schema-version",
        `项目 pageSchemaVersion ${project.pageSchemaVersion} 与渲染器 ${PAGE_SCHEMA_VERSION} 不一致`,
      ),
    );
  }
  if (project.template.mode !== project.mode || project.template.layout !== project.layout) {
    errors.push(
      issue(
        "project.template",
        "project/template-mismatch",
        "project.template 与顶层 mode/layout 不一致",
      ),
    );
  }
  const window = project.app.window;
  if (window.minWidth > window.width || window.minHeight > window.height) {
    errors.push(
      issue("project.app.window", "project/window-invalid", "窗口最小尺寸不能大于初始尺寸"),
    );
  }
  const pageResult = validatePage({
    page,
    project,
    pageSchema,
    mode: project.mode,
  });
  errors.push(...pageResult.errors);
  return { ok: errors.length === 0, errors: errors.slice(0, 40) };
}

/**
 * Composes the final page for one mode from a layout template. Blocks may
 * carry `modes`; those are stripped, so the shipped page contains no hidden
 * cross-mode branches.
 */
export function composePage(template, mode) {
  const blocks = template.blocks
    .filter((block) => !Array.isArray(block.modes) || block.modes.includes(mode))
    .map(({ modes, ...rest }) => rest);
  return {
    schemaVersion: template.schemaVersion,
    ...(template.navigationVersion === undefined ? {} : { navigationVersion: template.navigationVersion }),
    mode,
    layout: template.layout,
    title: template.title,
    theme: template.theme,
    blocks,
  };
}

/**
 * Validates a layout template for one mode (and thus every block that
 * survives pruning). Template-only structural checks catch duplicate ids
 * across modes before composition.
 */
export function validateTemplate({ template, pageSchema, mode }) {
  const errors = [];
  if (!isPlainObject(template)) {
    return { ok: false, errors: [issue("template", "page/template-invalid", "模板必须是对象")] };
  }
  if (template.schemaVersion !== PAGE_SCHEMA_VERSION) {
    errors.push(issue("template.schemaVersion", "page/schema-version", "模板 schema 版本不匹配"));
  }
  if (!LAYOUTS[template.layout]) {
    errors.push(issue("template.layout", "page/unknown-layout", `未注册布局 ${template.layout}`));
  }
  if (!Array.isArray(template.blocks)) {
    errors.push(issue("template.blocks", "page/template-invalid", "模板缺少 blocks 数组"));
    return { ok: false, errors };
  }
  const ids = new Set();
  template.blocks.forEach((block, index) => {
    if (!block || typeof block !== "object") {
      errors.push(issue(`template.blocks[${index}]`, "page/template-invalid", "区块必须是对象"));
      return;
    }
    if (ids.has(block.id)) {
      errors.push(issue(`template.blocks[${index}].id`, "page/duplicate-block", "模板区块标识重复"));
    }
    ids.add(block.id);
    if (block.modes !== undefined) {
      if (
        !Array.isArray(block.modes) ||
        block.modes.length === 0 ||
        block.modes.some((modeId) => !MODES.includes(modeId))
      ) {
        errors.push(
          issue(`template.blocks[${index}].modes`, "page/template-invalid", "modes 必须是非空的 a/b/d 子集"),
        );
      }
    }
  });
  const composed = composePage(template, mode);
  const result = validatePage({
    page: composed,
    project: {
      mode,
      layout: template.layout,
      pageSchemaVersion: PAGE_SCHEMA_VERSION,
    },
    pageSchema,
    mode,
  });
  errors.push(...result.errors);
  return { ok: errors.length === 0, errors: errors.slice(0, 40) };
}
