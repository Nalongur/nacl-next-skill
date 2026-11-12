import { store } from "../state/store";
import { effectiveIdentity, selectedInstance, selectedProfile } from "../state/store";

/**
 * Resolves a registered binding path to live reactive state. The path set
 * is closed by contract/registry.mjs; unknown paths are a configuration
 * error caught before mount, never a silent undefined.
 */
export function resolveBinding(path: string): unknown {
  switch (path) {
    case "instances.items":
      return store.instances;
    case "instances.deleted":
      return store.deletedInstances;
    case "instances.selected":
      return store.selectedInstanceId;
    case "instances.selectedInstance":
      return selectedInstance();
    case "java.detected":
      return store.javaDetected;
    case "profiles.items":
      return store.profiles;
    case "profiles.selected":
      return store.selectedProfileId;
    case "microsoft.account":
      return store.microsoft.account;
    case "tasks.items":
      return store.tasks;
    case "tasks.subscription":
      return {
        status: store.eventStatus,
        error: store.eventsError,
        polling: store.taskPolling,
      };
    case "logs.items":
      return store.logs;
    case "logs.selected":
      return store.selectedLog;
    case "logs.content":
      return store.logContent;
    case "preview.current":
      return store.preview;
    case "launch.last":
      return store.launchLast;
    case "identity.selectedKind":
      return store.selectedIdentityKind;
    case "identity.effective":
      return effectiveIdentity();
    case "app.mode":
      return store.mode;
    case "app.adapter":
      return store.adapterKind;
    case "app.eventStatus":
      return store.eventStatus;
    case "app.sdkVersion":
      return store.projectInfo?.sdkVersion ?? null;
    default:
      return undefined;
  }
}

export { selectedProfile };
