/**
 * ui/bridge.ts
 *
 * Messaging with the plugin sandbox (plugin.ts) and user feedback (toasts).
 *
 * The plugin UI runs in an iframe; `penpot` only exists in the sandbox. The
 * channel is parent.postMessage, which Penpot forwards to
 * penpot.ui.onMessage, and window "message" events for the way back.
 */

import { signal } from "@preact/signals";
import type { Op, OpResult, PluginMessage, UiMessage, ValidationReport } from "../shared/protocol";
import { applySnapshot, documentFonts, selection, unsupportedVersion } from "./store";

export function sendToPlugin(message: UiMessage): void {
  parent.postMessage(message, "*");
}

// ── Toasts ───────────────────────────────────────────────────────────────

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

export const toasts = signal<Toast[]>([]);
let nextToastId = 1;

export function showToast(message: string, kind: Toast["kind"] = "info"): void {
  const toast = { id: nextToastId++, message, kind };
  toasts.value = [...toasts.value, toast];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== toast.id);
  }, kind === "error" ? 6000 : 3000);
}

// ── Requests ─────────────────────────────────────────────────────────────

let nextReqId = 1;
const pendingOps = new Map<number, (results: OpResult[]) => void>();
const pendingValidations = new Map<number, (report: ValidationReport) => void>();

/** Number of operation batches waiting for the plugin (drives a busy hint). */
export const pendingCount = signal(0);

/** Send operations to the plugin; failures and summaries become toasts. */
export function runOps(ops: Op[]): Promise<OpResult[]> {
  if (ops.length === 0) return Promise.resolve([]);
  const reqId = nextReqId++;
  pendingCount.value++;
  return new Promise<OpResult[]>((resolve) => {
    pendingOps.set(reqId, resolve);
    sendToPlugin({ type: "ops", reqId, ops });
  }).then((results) => {
    pendingCount.value--;
    const failures = results.filter((r) => !r.ok);
    if (failures.length === 1 && ops.length === 1) {
      showToast(failures[0].error ?? "The operation failed", "error");
    } else if (failures.length > 0) {
      showToast(`${failures.length} of ${ops.length} operations failed: ${failures[0].error ?? ""}`, "error");
    }
    const messages = results.filter((r) => r.ok && r.message).map((r) => r.message!);
    if (messages.length > 0) showToast(messages.join(" · "));
    return results;
  });
}

export function requestValidation(): Promise<ValidationReport> {
  const reqId = nextReqId++;
  return new Promise((resolve) => {
    pendingValidations.set(reqId, resolve);
    sendToPlugin({ type: "validate", reqId });
  });
}

export function requestDocumentFonts(): void {
  sendToPlugin({ type: "scan-fonts" });
}

// ── Theme ────────────────────────────────────────────────────────────────

// Older Penpot reports its dark theme as "default".
function normalizeTheme(theme: string): string {
  return theme === "light" ? "light" : "dark";
}

// With manifest "version": 2 Penpot moves the query string into the hash
// (index.html#/?theme=dark), so read both.
export function applyInitialTheme(): void {
  const hashQuery = window.location.hash.split("?")[1] ?? "";
  const theme = new URLSearchParams(window.location.search).get("theme")
    ?? new URLSearchParams(hashQuery).get("theme");
  document.body.dataset.theme = normalizeTheme(theme ?? "light");
}

// ── Messages from the plugin ─────────────────────────────────────────────

export function listenToPlugin(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as PluginMessage;
    switch (msg?.type) {
      case "themechange":
        document.body.dataset.theme = normalizeTheme(msg.theme);
        break;
      case "snapshot":
        applySnapshot(msg.snapshot);
        break;
      case "ops-result": {
        const resolve = pendingOps.get(msg.reqId);
        pendingOps.delete(msg.reqId);
        resolve?.(msg.results);
        break;
      }
      case "selection":
        selection.value = msg.selection;
        break;
      case "validation": {
        const resolve = pendingValidations.get(msg.reqId);
        pendingValidations.delete(msg.reqId);
        resolve?.(msg.report);
        break;
      }
      case "fonts-loaded":
        documentFonts.value = msg.fonts;
        break;
      case "error":
        showToast(msg.message, "error");
        break;
      case "unsupported":
        unsupportedVersion.value = msg.penpotVersion;
        break;
    }
  });
}
