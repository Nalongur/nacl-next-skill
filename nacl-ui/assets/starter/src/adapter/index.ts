import type { ProjectConfig } from "../contract/page";
import { createIpcAdapter } from "./ipc";
import { createMockAdapter } from "./mock";
import type { LauncherAdapter } from "./types";

/**
 * Adapter selection is explicit: project config decides, with a dev-only
 * `VITE_NACL_ADAPTER=mock` override for browser layout work. There is no
 * implicit fallback from a failing IPC backend to mock data.
 */
export function createAdapter(project: ProjectConfig): LauncherAdapter {
  const override = import.meta.env.VITE_NACL_ADAPTER;
  const kind = override === "mock" ? "mock" : project.adapter;
  return kind === "mock"
    ? createMockAdapter(project.mode, project.sdk.version, project.pageSchemaVersion)
    : createIpcAdapter();
}
