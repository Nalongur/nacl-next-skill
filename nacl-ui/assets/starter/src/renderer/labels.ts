import type { PageMode } from "../contract/page";

export function modeLabel(mode: PageMode): string {
  switch (mode) {
    case "a":
      return "A · 仅正版";
    case "b":
      return "B · 仅本地";
    case "d":
      return "D · 共存";
    default:
      return mode;
  }
}

export function adapterLabel(kind: "ipc" | "mock"): string {
  return kind === "ipc" ? "IPC · 桌面后端" : "MOCK · 模拟数据";
}

export function eventLabel(status: string): string {
  switch (status) {
    case "subscribed":
      return "task-update 已订阅";
    case "connecting":
      return "正在订阅 task-update";
    case "failed":
      return "事件订阅失败 · 轮询恢复";
    default:
      return "事件未连接";
  }
}

export function taskStateLabel(state: string): string {
  switch (state) {
    case "queued":
      return "排队";
    case "running":
      return "运行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return state;
  }
}

export function formatTime(epochMs: number | string | bigint): string {
  try {
    const value = typeof epochMs === "bigint" ? Number(epochMs) : Number(epochMs);
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}
