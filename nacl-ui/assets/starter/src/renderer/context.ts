import type { InjectionKey } from "vue";
import type { ActionOutcome } from "../adapter/types";
import type { ActionController } from "../state/actions";

export const ACTION_CONTROLLER: InjectionKey<ActionController> =
  Symbol("nacl-next-actions");

export const OPEN_LOG_PAGE: InjectionKey<() => void> = Symbol("nacl-next-open-log-page");

export type PageAction = (
  payload?: Record<string, unknown>,
) => Promise<ActionOutcome>;

export type PageActions = Record<string, PageAction | undefined>;

export interface SubscriptionState {
  status: string;
  error: string | null;
  polling: boolean;
}
