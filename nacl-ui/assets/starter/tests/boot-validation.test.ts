import { beforeEach, describe, expect, test, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import projectJson from "../nacl.project.json";
import pageJson from "../src/page.json";
import pageSchema from "../schema/page.schema.json";
import projectSchema from "../schema/project.schema.json";

/**
 * Root-component startup regressions (review S3-R2): invalid generated
 * configuration must land on the stable config-error screen with an error
 * code and JSON path — never on a render exception — and must not build the
 * business adapter. The app component is rendered through Vue's own SSR
 * renderer, so no DOM or extra test dependency is involved.
 */

const adapterState = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../src/adapter", () => ({
  createAdapter: () => {
    adapterState.calls += 1;
    return { kind: "mock" } as never;
  },
}));

vi.mock("../src/boot-config", () => ({ bootConfig: {} }));

import { bootConfig } from "../src/boot-config";
import App from "../src/App.vue";

type DeepWritable<T> = T;

function clone<T>(value: T): DeepWritable<T> {
  return structuredClone(value);
}

interface ConfigPatch {
  project?: (project: Record<string, unknown>) => void;
  page?: (page: Record<string, unknown>) => void;
}

function applyConfig(patch: ConfigPatch = {}) {
  const project = clone(projectJson as Record<string, unknown>);
  const page = clone(pageJson as Record<string, unknown>);
  patch.project?.(project);
  patch.page?.(page);
  Object.assign(bootConfig, { project, page, projectSchema, pageSchema });
}

async function renderApp(): Promise<string> {
  const app = createSSRApp(App);
  return renderToString(app);
}

beforeEach(() => {
  adapterState.calls = 0;
});

describe("root boot validation", () => {
  test("缺失 theme 时渲染错误页并给出稳定错误码与路径", async () => {
    applyConfig({
      page: (page) => {
        delete page.theme;
      },
    });
    const html = await renderApp();

    expect(html).toContain("配置未通过校验");
    expect(html).toContain("页面没有挂载");
    expect(html).toContain("theme");
    expect(html).toContain("schema/required");
    expect(adapterState.calls).toBe(0);
  });

  test("theme 为 null 时显示类型错误而不是渲染异常", async () => {
    applyConfig({
      page: (page) => {
        page.theme = null;
      },
    });
    const html = await renderApp();

    expect(html).toContain("配置未通过校验");
    expect(html).toContain("schema/type");
    expect(html).toContain("/theme");
    expect(adapterState.calls).toBe(0);
  });

  test("页面 schema 版本不匹配时显示版本错误码", async () => {
    applyConfig({
      page: (page) => {
        page.schemaVersion = 2;
      },
    });
    const html = await renderApp();

    expect(html).toContain("page/schema-version");
    expect(html).toContain("page.schemaVersion");
    expect(adapterState.calls).toBe(0);
  });

  test("未知组件显示组件错误码与块路径", async () => {
    applyConfig({
      page: (page) => {
        (page.blocks as Array<Record<string, unknown>>)[0].component = "NotAComponent";
      },
    });
    const html = await renderApp();

    expect(html).toContain("page/unknown-component");
    expect(html).toContain("page.blocks[0].component");
    expect(adapterState.calls).toBe(0);
  });

  test("project 缺失 app 字段时拒绝挂载", async () => {
    applyConfig({
      project: (project) => {
        delete project.app;
      },
    });
    const html = await renderApp();

    expect(html).toContain("配置未通过校验");
    expect(html).toContain("project/app");
    expect(adapterState.calls).toBe(0);
  });

  test("合法配置渲染加载页并恰好初始化一次适配器", async () => {
    applyConfig();
    const html = await renderApp();

    expect(html).toContain("正在启动固定渲染器");
    expect(html).not.toContain("配置未通过校验");
    expect(adapterState.calls).toBe(1);
  });

  test("加载与错误根界面不应用未校验的主题字段", async () => {
    applyConfig();
    const loading = await renderApp();
    expect(loading).not.toContain("--accent");

    applyConfig({
      page: (page) => {
        delete page.theme;
      },
    });
    const broken = await renderApp();
    expect(broken).not.toContain("--accent");
  });
});
