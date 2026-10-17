# Changelog

## 2.0.0

Requires a Penpot version whose plugin API exposes design tokens
(`@penpot/plugin-types` 1.5+); older versions show a notice.

### Fixed

- Inactive sets and comparisons showed wrong or empty resolved values: the
  plugin now resolves aliases and math itself, against a context you pick
  (this set on top of the active ones, the active sets, or a theme).
- Name lookups no longer pick an arbitrary token from any set; Penpot's
  precedence (later active set wins) is respected.
- Multi-layer shadows lost every layer but the first when edited.
- Descriptions were dropped when creating, duplicating or moving tokens.
- Font families like `DM Sans, Inter` were saved as a single family.
- Typography: line height aliases point to number tokens; text decoration
  uses Penpot's `strike-through`.
- Aliases to tokens in other sets were flagged as broken.
- The comparison only listed the first set's tokens and compared raw values.
- Moving tokens to a set with the same names failed half-way.
- The plugin always opened in the light theme.
- Changes made outside the plugin (Penpot's panel, undo, collaborators)
  weren't picked up.

### Added

- Themes: create, rename, duplicate, delete, activate (one per group) and
  choose their sets; activate sets from the sidebar.
- Apply tokens to the selection, choosing the properties; a selection panel
  shows applied tokens and removes them; select the shapes using a token.
- Import and export in Penpot's JSON format (DTCG single set, multi-set with
  themes, legacy Tokens Studio).
- *Check tokens*: broken references, circular aliases, applied tokens no
  active set defines, file integrity errors.
- Compare against themes; differences highlighted.
- Renames offer to update references; deletes list what will break.
- Name conflicts when moving: skip, keep both or replace.
- Table: group by name path or type, inline editing, resizable columns.
- Inline validation of token and set names.
- Keyboard navigation and screen reader support (tree, menus, dialogs).
- Preferences remembered between sessions.

### Changed

- Rewritten UI (Preact + signals) and data layer (full catalog snapshot,
  typed message protocol, per-operation error reporting with toasts).
- Plugin manifest version 2 with the `allow:downloads` and
  `clipboard:write` permissions.
- Titles and buttons in sentence case.

## 1.x

First releases: sets, tokens of all types, aliases, color and font pickers,
bulk move/duplicate/delete and set comparison.
