# Design Token Manager for Penpot

A full-featured design token manager plugin for Penpot. Create, organize, and maintain your design tokens directly inside Penpot without leaving the workspace.

<img width="1497" height="888" alt="coverplugin" src="https://github.com/user-attachments/assets/74ce2b02-d053-4241-aef5-b5673d297c25" />

## Features

- **Token Sets**: Create and manage multiple token sets, organized in groups using `/` separators
- **Token Types**: Support for Color, Border Radius, Dimension, Font Family, Font Size, Font Weight, Letter Spacing, Number, Opacity, Rotation, Shadow, Sizing, Spacing, Stroke Width, Text Case, Text Decoration, and Typography
- **Themes**: Create, rename, duplicate and delete themes, pick the sets each one enables, and activate them from the sidebar (one per group)
- **Active sets**: Toggle which sets are active in Penpot straight from the sidebar
- **Resolution context**: Resolved values are computed by the plugin (aliases + math), against the viewed set on top of the active sets, the active sets as Penpot sees them, or any theme — so inactive sets show their real values
- **Aliases**: Reference other tokens by value using `{token.name}` syntax, with an inline alias picker
- **Color Picker**: Built-in color picker with HEX, RGB and HSL modes for color tokens
- **Token Search**: Filter tokens by name, type or value within any set
- **Live sync**: Changes made outside the plugin (Penpot's tokens panel, undo, collaborators) are picked up automatically
- **Bulk Actions**: Select multiple tokens and move, duplicate or delete them in one action, with name-conflict handling (skip, keep both, replace)
- **Safe renames**: Renaming or deleting a token shows which tokens reference it, and renames can update those references
- **Multi-layer shadows**: Edit every layer of a shadow token
- **Apply to selection**: Apply a token to the shapes selected in Penpot, choosing the properties (fill or stroke, paddings, corners…); warns when Penpot would resolve that name from another set
- **Selection panel**: See the tokens applied to the selected shapes, jump to their definition, and remove them
- **Find usages**: Select every shape on the page that uses a token
- **Check tokens**: Lists broken references and circular aliases, applied tokens that no active set defines, and Penpot's file integrity errors
- **Import / Export**: JSON in Penpot's format (DTCG / Tokens Studio), single set or all sets with themes; download or copy to the clipboard
- **Sortable Table**: Sort tokens by name, value, resolved value or type; group them by name path or type; resize columns
- **Inline editing**: Double-click a simple value to edit it in place
- **Keyboard friendly**: Navigable set tree, menus and dialogs; Escape closes only the topmost layer
- **Penpot Theme Sync**: Automatically adapts to Penpot's light and dark theme

## How to Use

1. **Create a token set** with the `+` button in the sidebar or on the overview screen — or **import** a JSON file (Penpot, DTCG or Tokens Studio format) with the upload button.
2. **Add tokens**: open a set and click `+ New token`, pick a type and fill in the name and value. Double-click a simple value in the table to change it in place.
3. **Reference other tokens** with `{token.name}`: type it, or use the alias button next to the value field. Click an alias chip in the table to change the reference.
4. **Check the resolved values**: the *Resolve* selector above the table decides which sets resolve aliases and math — this set on top of the active ones, the active sets as Penpot sees them, or a theme.
5. **Organize with themes**: the gear next to *Themes* opens the theme editor; click a theme in the sidebar to activate it. The checkbox next to each set turns it on or off in Penpot.
6. **Apply tokens**: select shapes in Penpot, then use the apply button on a token row (or *Apply to selection…* in its menu) and choose the properties. The *Selection* panel at the bottom shows what's applied and lets you remove it.
7. **Compare** sets or themes side by side from a set's menu (*Compare with…*); differences are highlighted.
8. **Keep it healthy** with *Check tokens* (sidebar footer): broken references, circular aliases, applied tokens no active set defines, and file integrity errors.

## Technical Details

- Built with TypeScript and Vite; the UI uses Preact with signals (`src/ui/`)
- Uses the official Penpot Plugin API (`@penpot/plugin-types`); the sandbox code is `src/plugin.ts`
- Shared, unit-tested logic in `src/shared/`: message protocol, token resolver (aliases + math), value conversion for each token type, DTCG import/export
- Styled with `@penpot/plugin-styles` to match the native Penpot UI

## Installation

In Penpot, open the Plugin Manager (`Ctrl + Alt + P`) and install `https://design-token-manager.pages.dev/manifest.json`.

To run your own build: `npm run build && npm run preview`, then install `http://localhost:4400/manifest.json`.

The plugin asks for these permissions: read and write the file content and library (tokens, applying them to shapes), downloads (exporting JSON) and clipboard write (copying an export).

## Development

Requirements: Node.js `^20.19.0 || >=22.12.0` and a Penpot version whose plugin API exposes design tokens (`@penpot/plugin-types` 1.5+). On older Penpot versions the plugin shows a notice instead of the UI.

```bash
npm install        # install dependencies
npm run dev        # build in watch mode
npm run build      # typecheck + production build
npm run preview    # serve dist/ on http://localhost:4400
npm run typecheck  # TypeScript only
npm run lint       # ESLint
npm test           # unit tests (Vitest), including a UI smoke test
```

Manual test checklist for a release: [docs/QA.md](docs/QA.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## License

This project is licensed under the MIT License - see the LICENSE file for details.
