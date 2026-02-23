# Design Token Manager for Penpot

A full-featured design token manager plugin for Penpot. Create, organize, and maintain your design tokens directly inside Penpot without leaving the workspace.

## Features

- **Token Sets**: Create and manage multiple token sets, organized in groups using `/` separators
- **Token Types**: Support for Color, Border Radius, Dimension, Font Family, Font Size, Font Weight, Letter Spacing, Number, Opacity, Rotation, Shadow, Sizing, Spacing, Stroke Width, Text Case, Text Decoration, and Typography
- **Themes**: Create and manage token themes to switch between design modes (e.g. light/dark)
- **Aliases**: Reference other tokens by value using `{token.name}` syntax, with an inline alias picker
- **Color Picker**: Built-in color picker with HEX, RGB and HSL modes for color tokens
- **Token Search**: Filter tokens by name, type or value within any set
- **Bulk Actions**: Select multiple tokens and move or duplicate them across sets in one action
- **Import / Export**: Upload and download token sets as JSON files
- **Sortable Table**: Sort tokens by name, value, resolved value or type
- **Penpot Theme Sync**: Automatically adapts to Penpot's light and dark theme

## How to Use

1. **Create a token set** using the `+` button in the sidebar or the overview screen
2. **Add tokens** by selecting a set and clicking `+ New token` — choose a type and fill in the name and value
3. **Use aliases** by typing `{` in the value field to reference another token, or click the alias chip to open the picker
4. **Organize with themes** using the gear icon at the bottom of the sidebar to create and manage themes
5. **Bulk actions** — select multiple tokens via the row checkboxes, then move or duplicate them using the action bar that appears above the table

## Technical Details

- Built with TypeScript and Vite
- Uses the official Penpot Plugin API (`@penpot/plugin-types`)
- Styled with `@penpot/plugin-styles` to match the native Penpot UI
- No external runtime dependencies

## Installation

1. Build the plugin: `npm run build`
2. In Penpot, open the Plugin Manager (`Ctrl + Alt + P`) and load `http://localhost:4400/manifest.json`

## Development

```bash
# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Build for production
npm run build
```

## License

MIT
