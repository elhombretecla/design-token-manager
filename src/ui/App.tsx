/**
 * Application shell: sidebar, the overview or the selected set, the
 * selection panel, and the overlay hosts (modal, context menu, alias
 * editor, toasts).
 */

import { pendingCount } from "./bridge";
import { Overview } from "./components/Overview";
import { AliasEditorHost } from "./components/pickers/AliasEditorHost";
import { SelectionPanel } from "./components/SelectionPanel";
import { Sidebar } from "./components/Sidebar";
import { TokensView } from "./components/TokensView";
import { ContextMenuHost, ModalHost, Toasts } from "./overlays";
import { loaded, selectedSet, unsupportedVersion } from "./store";

function Unsupported({ version }: { version: string }) {
  return (
    <main class="main-content">
      <div class="empty-state-msg body-s">
        This version of Penpot{version ? ` (Penpot ${version})` : ""} doesn't support design tokens in plugins.
        Please update Penpot to use Design Token Manager.
      </div>
    </main>
  );
}

function Loading() {
  return (
    <main class="main-content" aria-busy="true">
      <div class="empty-state-msg body-s">Loading tokens…</div>
    </main>
  );
}

export function App() {
  if (unsupportedVersion.value !== null) {
    return <div class="app-container"><Unsupported version={unsupportedVersion.value} /></div>;
  }
  if (!loaded.value) {
    return <div class="app-container"><Loading /></div>;
  }
  return (
    <div class="app-container" aria-busy={pendingCount.value > 0 ? "true" : undefined}>
      <Sidebar />
      <main class="main-content">
        {selectedSet.value ? <TokensView /> : <Overview />}
        <SelectionPanel />
      </main>
      <ModalHost />
      <ContextMenuHost />
      <AliasEditorHost />
      <Toasts />
    </div>
  );
}
