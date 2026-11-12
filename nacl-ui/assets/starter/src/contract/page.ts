/** Page contract types. Rust-generated IPC types stay in sdk/contracts and
 * src/contracts/shell; this file only describes the JSON page envelope. */

export type PageMode = "a" | "b" | "d";
export type LayoutId = "sidebar" | "studio" | "nacl";
export type SlotId =
  | "nav"
  | "main"
  | "aside"
  | "top"
  | "left"
  | "center"
  | "bottom"
  | "right";
export type AdapterKind = "ipc" | "mock";

export interface PageTheme {
  accent: string;
  density: "comfortable" | "compact";
  radius: number;
  font: "system" | "serif" | "mono";
  colorScheme: "dark";
}

export interface PageBlock {
  id: string;
  slot: SlotId;
  page?: "home" | "instances" | "logs" | "settings";
  component: string;
  title?: string;
  bindings?: Record<string, string>;
  actions?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
}

export interface PageDefinition {
  schemaVersion: number;
  navigationVersion?: 1;
  mode: PageMode;
  layout: LayoutId;
  title: string;
  theme: PageTheme;
  blocks: PageBlock[];
}

export interface ProjectConfig {
  schemaVersion: number;
  mode: PageMode;
  layout: LayoutId;
  adapter: AdapterKind;
  pageSchemaVersion: number;
  sdk: {
    name: "nacl-next-sdk";
    version: string;
    snapshotSha256: string;
  };
  template: {
    version: number;
    layout: LayoutId;
    mode: PageMode;
  };
  app: {
    productName: string;
    identifier: string;
    window: {
      width: number;
      height: number;
      minWidth: number;
      minHeight: number;
    };
  };
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}
