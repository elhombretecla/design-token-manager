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

1. **Create a token set** using the `+` button in the sidebar or the overview screen
2. **Add tokens** by selecting a set and clicking `+ New token` — choose a type and fill in the name and value
3. **Use aliases** by typing `{` in the value field to reference another token, or click the alias chip to open the picker
4. **Organize with themes** using the gear icon at the bottom of the sidebar to create and manage themes
5. **Bulk actions** — select multiple tokens via the row checkboxes, then move or duplicate them using the action bar that appears above the table

## Technical Details

- Built with TypeScript and Vite; the UI uses Preact with signals (`src/ui/`)
- Uses the official Penpot Plugin API (`@penpot/plugin-types`); the sandbox code is `src/plugin.ts`
- Shared, unit-tested logic in `src/shared/`: message protocol, token resolver (aliases + math), DTCG import/export
- Styled with `@penpot/plugin-styles` to match the native Penpot UI

## Installation

1. Build the plugin: `npm run build`
2. In Penpot, open the Plugin Manager (`Ctrl + Alt + P`) and load `http://localhost:4400/manifest.json`

## Development

Requirements: Node.js `^20.19.0 || >=22.12.0` and a Penpot version whose plugin API exposes design tokens (`@penpot/plugin-types` 1.5+). On older Penpot versions the plugin shows a notice instead of the UI.

```bash
npm install        # install dependencies
npm run dev        # build in watch mode
npm run build      # typecheck + production build
npm run typecheck  # TypeScript only
npm run lint       # ESLint
npm test           # unit tests (Vitest)
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
