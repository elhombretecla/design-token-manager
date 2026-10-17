/**
 * Context menu contents for sets and tokens (shared by right-click, the
 * "more" buttons and the keyboard).
 */

import type { SerializedToken } from "../../shared/types";
import { runOps } from "../bridge";
import { Icon } from "../icons";
import type { MenuItem } from "../overlays";
import { enterCompare, selection, snapshotSet } from "../store";
import { openApplyTokenModal } from "./modals/ApplyTokenModal";
import { openExportModal } from "./modals/ExportModal";
import { openDeleteSetModal, openRenameSetModal } from "./modals/SetModals";
import { openDeleteTokensModal, openMoveTokensModal } from "./modals/TokenActions";
import { openEditTokenModal } from "./modals/TokenEditorModal";

export function setMenuItems(setId: string): MenuItem[] {
  const set = snapshotSet(setId);
  if (!set) return [];
  return [
    {
      label: set.active ? "Deactivate in Penpot" : "Activate in Penpot",
      icon: <Icon name="check" />,
      action: () => void runOps([{ op: "set-set-active", setId, active: !set.active }]),
    },
    { label: "Rename", icon: <Icon name="rename" />, divider: true, action: () => openRenameSetModal(setId) },
    { label: "Duplicate", icon: <Icon name="duplicate" />, action: () => void runOps([{ op: "duplicate-set", setId }]) },
    { label: "Compare with…", icon: <Icon name="compare" />, action: () => enterCompare(setId) },
    { label: "Export", icon: <Icon name="exportIcon" />, action: () => openExportModal(setId) },
    { label: "Delete", icon: <Icon name="trash" />, danger: true, divider: true, action: () => openDeleteSetModal(setId) },
  ];
}

export function tokenMenuItems(setId: string, token: SerializedToken): MenuItem[] {
  const hasSelection = selection.value.total > 0;
  return [
    {
      label: "Apply to selection…",
      icon: <Icon name="apply" />,
      disabled: !hasSelection,
      action: () => openApplyTokenModal(setId, token.id),
    },
    {
      label: "Select shapes using it",
      icon: <Icon name="target" />,
      action: () => void runOps([{ op: "select-token-usages", tokenName: token.name }]),
    },
    { label: "Edit", icon: <Icon name="edit" />, divider: true, action: () => openEditTokenModal(setId, token.id) },
    { label: "Move…", icon: <Icon name="move" />, action: () => openMoveTokensModal(setId, [token.id]) },
    {
      label: "Duplicate",
      icon: <Icon name="duplicate" />,
      action: () => void runOps([{ op: "duplicate-token", setId, tokenId: token.id }]),
    },
    { label: "Delete", icon: <Icon name="trash" />, danger: true, divider: true, action: () => openDeleteTokensModal(setId, [token.id]) },
  ];
}
