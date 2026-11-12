/**
 * Fixed page contract registry (single source for the renderer and the
 * Node/CI validators).
 *
 * JSON may choose a layout, order/assign registered blocks, bind registered
 * data paths, wire registered actions and set validated presentation
 * parameters. It cannot introduce components, data sources, actions, raw
 * HTML, scripts or arbitrary IPC command names.
 */

export const PAGE_SCHEMA_VERSION = 1;
export const MODES = ["a", "b", "d"];

/** @typedef {"a"|"b"|"d"} Mode */
/** @typedef {keyof typeof LAYOUTS} LayoutId */

export const LAYOUTS = {
  nacl: {
    navigationVersion: 1,
    slots: ["nav", "main", "aside"],
    slotLabels: { nav: "身份", main: "主区域", aside: "详情" },
    requiredComponents: ["InstanceList", "LaunchPanel", "TaskMonitor", "LogViewer", "InstanceDetails", "JavaPanel"],
  },
  sidebar: {
    slots: ["nav", "main", "aside"],
    slotLabels: { nav: "导航与身份", main: "工作区", aside: "实例检查器" },
    requiredComponents: [
      "InstanceList",
      "LaunchPanel",
      "TaskMonitor",
      "LogViewer",
      "InstanceDetails",
      "JavaPanel",
    ],
  },
  studio: {
    slots: ["top", "left", "center", "bottom", "right"],
    slotLabels: {
      top: "命令栏与启动",
      left: "实例库与身份",
      center: "任务舞台",
      bottom: "日志控制台",
      right: "配置检查器",
    },
    requiredComponents: [
      "InstanceList",
      "LaunchPanel",
      "TaskMonitor",
      "LogViewer",
      "InstanceDetails",
      "JavaPanel",
    ],
  },
};

/**
 * Registered data sources. A binding names a path; the renderer resolves it
 * from the reactive store. `capability`/`modes` are checked before mount.
 */
export const BINDINGS = {
  "instances.items": { capability: "instance.manage" },
  "instances.deleted": { capability: "instance.manage" },
  "instances.selected": {},
  "instances.selectedInstance": { capability: "instance.manage" },
  "java.detected": { capability: "java.detect" },
  "profiles.items": { capability: "account.local" },
  "profiles.selected": { capability: "account.local" },
  "microsoft.account": { capability: "account.microsoft" },
  "tasks.items": {},
  "tasks.subscription": {},
  "logs.items": { capability: "diagnostics.logs" },
  "logs.selected": { capability: "diagnostics.logs" },
  "logs.content": { capability: "diagnostics.logs" },
  "preview.current": { capability: "launch.game" },
  "launch.last": { capability: "launch.game" },
  "identity.selectedKind": { modes: ["d"] },
  "identity.effective": {},
  "app.mode": {},
  "app.adapter": {},
  "app.eventStatus": {},
  "app.sdkVersion": {},
};

/**
 * Registered actions. `capability` uses the same names as the SDK's
 * capability registry; `modes` restricts UI-only actions that compose
 * several sources (D's identity picker).
 */
export const ACTIONS = {
  "host.preferences.get": {},
  "host.preferences.save": {},
  "instances.refresh": { capability: "instance.manage" },
  "instances.select": {},
  "instances.create": { capability: "instance.manage" },
  "instances.duplicate": { capability: "instance.manage" },
  "instances.delete": { capability: "instance.manage" },
  "instances.restore": { capability: "instance.manage" },
  "instances.purge": { capability: "instance.manage" },
  "instances.update-java": { capability: "instance.manage" },
  "instances.java-auto": { capability: "instance.manage" },
  "instances.update-settings": { capability: "instance.manage" },
  "instances.update-advanced": { capability: "instance.manage" },
  "instances.rename": { capability: "instance.manage" },
  "java.detect": { capability: "java.detect" },
  "java.inspect": { capability: "java.detect" },
  "profiles.refresh": { capability: "account.local" },
  "profiles.select": { capability: "account.local" },
  "profiles.create": { capability: "account.local" },
  "profiles.rename": { capability: "account.local" },
  "profiles.delete": { capability: "account.local" },
  "microsoft.refresh": { capability: "account.microsoft" },
  "microsoft.login.begin": { capability: "account.microsoft" },
  "microsoft.login.complete": { capability: "account.microsoft" },
  "microsoft.login.cancel": { capability: "account.microsoft" },
  "microsoft.logout": { capability: "account.microsoft" },
  "identity.refresh": { modes: ["d"] },
  "identity.select": { modes: ["d"] },
  "launch.resolve": { capability: "launch.game" },
  "launch.start": { capability: "launch.game" },
  "tasks.refresh": {},
  "tasks.status": {},
  "tasks.resubscribe": {},
  "logs.refresh": { capability: "diagnostics.logs" },
  "logs.read": { capability: "diagnostics.logs" },
  "logs.select": { capability: "diagnostics.logs" },
};

/**
 * Component contracts. `bindings` and `actions` map component prop keys to
 * the only registered source/action each may use; pages must supply the
 * required ones. `params` is the allow-list of presentation switches.
 */
export const COMPONENTS = {
  HostPreferences: {
    slots: ["main", "aside"], modes: MODES, bindings: {}, requiredBindings: [],
    actions: { load: "host.preferences.get", save: "host.preferences.save" }, requiredActions: ["load", "save"], params: {},
  },
  InstanceList: {
    slots: ["nav", "left"],
    modes: MODES,
    bindings: {
      items: "instances.items",
      selected: "instances.selected",
      deleted: "instances.deleted",
    },
    requiredBindings: ["items", "selected"],
    actions: {
      select: "instances.select",
      refresh: "instances.refresh",
      create: "instances.create",
      duplicate: "instances.duplicate",
      delete: "instances.delete",
      restore: "instances.restore",
      purge: "instances.purge",
    },
    requiredActions: ["select"],
    params: {
      compact: { type: "boolean" },
      allowCreate: { type: "boolean" },
      allowDelete: { type: "boolean" },
      allowRestore: { type: "boolean" },
      allowDuplicate: { type: "boolean" },
    },
  },
  InstanceDetails: {
    slots: ["aside", "right"],
    modes: MODES,
    bindings: { instance: "instances.selectedInstance" },
    requiredBindings: ["instance"],
    actions: { refresh: "instances.refresh", rename: "instances.rename" },
    requiredActions: [],
    params: {
      compact: { type: "boolean" },
      showPaths: { type: "boolean" },
    },
  },
  InstanceSettings: {
    slots: ["aside", "right"],
    modes: MODES,
    bindings: { instance: "instances.selectedInstance" },
    requiredBindings: ["instance"],
    actions: { save: "instances.update-settings", saveAdvanced: "instances.update-advanced" },
    requiredActions: ["save"],
    params: {},
  },
  JavaPanel: {
    slots: ["aside", "right"],
    modes: MODES,
    bindings: {
      instance: "instances.selectedInstance",
      detected: "java.detected",
    },
    requiredBindings: ["instance", "detected"],
    actions: {
      detect: "java.detect",
      set: "instances.update-java",
      auto: "instances.java-auto",
      inspect: "java.inspect",
    },
    requiredActions: ["detect", "set"],
    params: {
      compact: { type: "boolean" },
      allowManualPath: { type: "boolean" },
    },
  },
  LocalProfiles: {
    slots: ["nav", "left"],
    modes: ["b", "d"],
    bindings: {
      items: "profiles.items",
      selected: "profiles.selected",
    },
    requiredBindings: ["items", "selected"],
    actions: {
      select: "profiles.select",
      refresh: "profiles.refresh",
      create: "profiles.create",
      rename: "profiles.rename",
      delete: "profiles.delete",
    },
    requiredActions: ["select"],
    params: {
      compact: { type: "boolean" },
      showUuid: { type: "boolean" },
      allowRename: { type: "boolean" },
      allowDelete: { type: "boolean" },
      allowCreate: { type: "boolean" },
    },
  },
  MicrosoftIdentity: {
    slots: ["nav", "left"],
    modes: ["a", "d"],
    bindings: { account: "microsoft.account" },
    requiredBindings: ["account"],
    actions: {
      refresh: "microsoft.refresh",
      beginLogin: "microsoft.login.begin",
      completeLogin: "microsoft.login.complete",
      cancelLogin: "microsoft.login.cancel",
      logout: "microsoft.logout",
    },
    requiredActions: ["refresh", "beginLogin", "completeLogin", "cancelLogin", "logout"],
    params: {
      compact: { type: "boolean" },
      showConfigHint: { type: "boolean" },
    },
  },
  IdentityPicker: {
    slots: ["nav", "top", "left"],
    modes: ["d"],
    bindings: {
      account: "microsoft.account",
      profiles: "profiles.items",
      selectedKind: "identity.selectedKind",
      effective: "identity.effective",
    },
    requiredBindings: ["account", "profiles", "selectedKind", "effective"],
    actions: {
      refresh: "identity.refresh",
      select: "identity.select",
    },
    requiredActions: ["refresh", "select"],
    params: {
      compact: { type: "boolean" },
      showTrust: { type: "boolean" },
    },
  },
  LaunchPanel: {
    slots: ["main", "top"],
    modes: MODES,
    bindings: {
      instance: "instances.selectedInstance",
      identity: "identity.effective",
      preview: "preview.current",
    },
    requiredBindings: ["instance", "identity", "preview"],
    actions: {
      resolve: "launch.resolve",
      start: "launch.start",
      viewLog: "logs.select",
    },
    requiredActions: ["resolve", "start"],
    params: {
      emphasis: { type: "enum", values: ["standard", "hero"] },
      showJava: { type: "boolean" },
      compact: { type: "boolean" },
    },
  },
  TaskMonitor: {
    slots: ["main", "center"],
    modes: MODES,
    bindings: {
      tasks: "tasks.items",
      subscription: "tasks.subscription",
    },
    requiredBindings: ["tasks"],
    actions: {
      refresh: "tasks.refresh",
      status: "tasks.status",
      resubscribe: "tasks.resubscribe",
    },
    requiredActions: ["refresh"],
    params: {
      compact: { type: "boolean" },
      maxItems: { type: "integer", min: 1, max: 50 },
      showSubscription: { type: "boolean" },
    },
  },
  LogViewer: {
    slots: ["main", "bottom"],
    modes: MODES,
    bindings: {
      items: "logs.items",
      selected: "logs.selected",
      content: "logs.content",
    },
    requiredBindings: ["items", "selected", "content"],
    actions: {
      refresh: "logs.refresh",
      read: "logs.read",
      select: "logs.select",
    },
    requiredActions: ["refresh", "read"],
    params: {
      compact: { type: "boolean" },
      autoLoadFirst: { type: "boolean" },
      visibleLines: { type: "integer", min: 20, max: 500 },
    },
  },
};

/** Mode-specific required identity surface (in addition to layout blocks). */
export const IDENTITY_REQUIREMENTS = {
  a: ["MicrosoftIdentity"],
  b: ["LocalProfiles"],
  d: ["MicrosoftIdentity", "LocalProfiles", "IdentityPicker"],
};

/** @param {Mode} mode @param {string|undefined} capability */
export function modeAllowsCapability(mode, capability) {
  if (!capability) return true;
  if (capability === "account.microsoft") return mode !== "b";
  if (capability === "account.local") return mode !== "a";
  return true;
}

/** @param {Mode} mode @param {string} actionId */
export function actionAllowedInMode(mode, actionId) {
  const action = ACTIONS[actionId];
  if (!action) return false;
  if (action.modes && !action.modes.includes(mode)) return false;
  return modeAllowsCapability(mode, action.capability);
}

/** @param {Mode} mode @param {string} path */
export function bindingAllowedInMode(mode, path) {
  const binding = BINDINGS[path];
  if (!binding) return false;
  if (binding.modes && !binding.modes.includes(mode)) return false;
  return modeAllowsCapability(mode, binding.capability);
}

/** @param {Mode} mode @param {string} componentName */
export function componentAllowedInMode(mode, componentName) {
  const component = COMPONENTS[componentName];
  return Boolean(component && component.modes.includes(mode));
}
