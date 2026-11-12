// Validates the generated project config and page before typecheck/build.
// The same validator runs in the renderer at startup; this is the build gate.
//
// `validateProjectDirectory` is exported so the distributable Skill tools can
// reuse the exact same checks without duplicating them. Running this file
// directly keeps the original text/exit-code behaviour used by `npm run
// validate`.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateProject } from "../src/validation/validate-page.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonTypeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateProjectDirectory(projectRoot) {
  const root = path.resolve(projectRoot);
  const errors = [];

  function readJson(file, label) {
    try {
      return { ok: true, value: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch (error) {
      errors.push({
        path: file,
        code: "config/read-failed",
        message: `${label}无法读取：${error.message}`,
      });
      return { ok: false, value: null };
    }
  }

  function readText(file, label) {
    try {
      return fs.readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      errors.push({
        path: file,
        code: "config/read-failed",
        message: `${label}无法读取：${error.message}`,
      });
      return "";
    }
  }

  const projectRead = readJson("nacl.project.json", "项目配置");
  const pageRead = readJson("src/page.json", "页面配置");
  const pageSchemaRead = readJson("schema/page.schema.json", "页面 Schema");
  const projectSchemaRead = readJson("schema/project.schema.json", "项目 Schema");

  // Root shape is checked before any field access: null/false/0/""/[] parsed
  // successfully but are not project or page objects.
  for (const [entry, file, label] of [
    [projectRead, "nacl.project.json", "项目配置"],
    [pageRead, "src/page.json", "页面配置"],
    [pageSchemaRead, "schema/page.schema.json", "页面 Schema"],
    [projectSchemaRead, "schema/project.schema.json", "项目 Schema"],
  ]) {
    if (!entry.ok) continue;
    if (!isPlainObject(entry.value)) {
      errors.push({
        path: `${file}#`,
        code: "config/invalid-root",
        message: `${label}的 JSON 根必须是对象，实际为 ${jsonTypeName(entry.value)}`,
        file,
      });
    }
  }

  const project = projectRead.value;
  const page = pageRead.value;
  const pageSchema = pageSchemaRead.value;
  const projectSchema = projectSchemaRead.value;

  if (isPlainObject(project) && isPlainObject(page) && isPlainObject(pageSchema) && isPlainObject(projectSchema)) {
    const result = validateProject({ project, page, pageSchema, projectSchema });
    errors.push(...result.errors);

    const sdkToml = project.sdk?.snapshotSha256 ? readText("sdk/nacl-next-sdk/Cargo.toml", "SDK 清单") : "";
    const sdkVersion = /^version\s*=\s*"([^"]+)"/m.exec(sdkToml)?.[1];
    if (sdkVersion && project.sdk?.version !== sdkVersion) {
      errors.push({
        path: "nacl.project.json#/sdk/version",
        code: "project/sdk-version-mismatch",
        message: `项目记录 SDK ${project.sdk?.version}，快照清单为 ${sdkVersion}`,
      });
    }

    const shellToml = readText("src-tauri/Cargo.toml", "IPC 壳清单");
    if (project.sdk?.git) {
      const lock = readText("Cargo.lock", "Cargo 锁文件");
      const git = "https://github.com/Nalongur/nacl-next-sdk.git";
      const rev = "160fea422ab679bc5d8fa74c6a4035264c718db5";
      const dependency = `nacl-next-sdk = { git = "${git}", rev = "${rev}" }`;
      const source = `source = "git+${git}?rev=${rev}#${rev}"`;
      if (project.sdk.git !== git || project.sdk.rev !== rev || !shellToml.includes(dependency) || !lock.includes(source)) {
        errors.push({path: "src-tauri/Cargo.toml", code: "project/sdk-source-mismatch", message: "SDK Git 来源或 Cargo 锁与固定提交不一致"});
      }
    }
    const featureMode = /default\s*=\s*\[\s*"mode-([abd])"\s*\]/m.exec(shellToml)?.[1];
    if (featureMode && featureMode !== project.mode) {
      errors.push({
        path: "src-tauri/Cargo.toml#/features/default",
        code: "project/build-mode-mismatch",
        message: `编译默认模式 mode-${featureMode} 与项目模式 ${project.mode} 不一致`,
      });
    }

    const tauri = readJson("src-tauri/tauri.conf.json", "Tauri 配置").value;
    if (isPlainObject(tauri) && isPlainObject(project.app)) {
      if (tauri.productName !== project.app.productName) {
        errors.push({
          path: "src-tauri/tauri.conf.json#/productName",
          code: "project/app-metadata-mismatch",
          message: "Tauri productName 与项目配置不一致",
        });
      }
      if (tauri.identifier !== project.app.identifier) {
        errors.push({
          path: "src-tauri/tauri.conf.json#/identifier",
          code: "project/app-metadata-mismatch",
          message: "Tauri identifier 与项目配置不一致",
        });
      }
      const window =
        isPlainObject(tauri.app) && Array.isArray(tauri.app.windows) ? tauri.app.windows[0] : null;
      if (isPlainObject(window) && isPlainObject(project.app.window)) {
        for (const key of ["width", "height", "minWidth", "minHeight"]) {
          if (window[key] !== project.app.window[key]) {
            errors.push({
              path: `src-tauri/tauri.conf.json#/app/windows/0/${key}`,
              code: "project/window-mismatch",
              message: `窗口字段 ${key} 与项目配置不一致`,
            });
          }
        }
      }
    }

    for (const required of [
      "src/contracts/shell/TaskRecord.ts",
      "sdk/contracts/InstanceConfig.ts",
      "sdk/contracts/SdkError.ts",
    ]) {
      if (!fs.existsSync(path.join(root, required))) {
        errors.push({
          path: required,
          code: "contract/missing",
          message: "缺少生成的 TypeScript 契约；请重新生成工程",
        });
      }
    }
  }

  const summary =
    isPlainObject(project) && isPlainObject(page)
      ? {
          mode: project.mode,
          layout: project.layout,
          adapter: project.adapter,
          blocks: Array.isArray(page.blocks) ? page.blocks.length : null,
        }
      : null;
  return { errors, summary };
}

function main() {
  const root = process.cwd();
  const { errors, summary } = validateProjectDirectory(root);
  if (errors.length > 0) {
    console.error(`配置校验失败（${errors.length} 项）：`);
    for (const error of errors) {
      console.error(`- ${error.path} [${error.code}] ${error.message}`);
    }
    process.exit(1);
  }
  console.log(
    `配置校验通过：mode ${summary.mode.toUpperCase()} / layout ${summary.layout} / adapter ${summary.adapter} / ${summary.blocks} blocks`,
  );
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();
