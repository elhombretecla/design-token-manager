# Release QA checklist

What the automated tests cover and what must be checked by hand inside
Penpot before a release.

## Automated (`npm test`)

| Area | File |
| --- | --- |
| Value conversion for all 17 token types: edit form → API → back, aliases, cloning, DTCG round trip, resolution | `src/shared/tokenValues.test.ts` |
| Resolver: aliases, math, precedence, contexts (set on top / active / theme), cycles, missing references, composites | `src/shared/resolver.test.ts`, `src/shared/math.test.ts` |
| Import / export (Penpot DTCG, multi-set with themes, legacy Tokens Studio, type aliases) | `src/shared/dtcg.test.ts` |
| Name rules, references, property catalog | `src/ui/lib/names.test.ts`, `src/shared/tokenProperties.test.ts` |
| Whole UI rendered against a fake catalog (table, grouping, inline edit, editor, alias editor, comparison, selection, modals, Escape) | `src/ui/App.test.tsx` |

The tests can't talk to Penpot: everything below needs a real file.

## Manual, in Penpot

Use a test file with two sets (`core` active, `theme/dark` inactive), a theme
`mode / dark` with both sets, and a page with a rectangle, a board with flex
layout and a text.

### Per token type

For each type, in a new set: **create** it, **edit** it (modal and, for
simple types, double-click in the table), make a second token that
**aliases** it, **move** it to another set, **apply** it to a shape with
the default properties, and **compare** the two sets.

| Type | Apply to | Check on the canvas |
| --- | --- | --- |
| color | rectangle (fill, stroke) | fill and stroke colors |
| borderRadius | rectangle (all corners, one corner) | radius |
| dimension | rectangle (width/height, x/y) | size, position |
| sizing | rectangle (width/height); flex child (min/max) | size, layout limits |
| spacing | board with flex layout (gap, padding) | gaps, paddings |
| borderWidth | rectangle with a stroke | stroke width |
| opacity | rectangle | layer opacity |
| rotation | rectangle | rotation |
| number | rectangle (rotation); text (line height) | rotation, line height |
| fontFamilies | text — use two families `DM Sans, Inter` | font family |
| fontSizes | text | font size |
| fontWeights | text | weight |
| letterSpacing | text | letter spacing |
| textCase | text | case |
| textDecoration | text — `strike-through` | decoration |
| typography | text — with an alias in a field | all text properties |
| shadow | rectangle — two layers, one inner | both shadows |

### Sets and themes

- [ ] Toggle a set's active checkbox: Penpot's tokens panel follows, themes turn off.
- [ ] Create, rename (group + name), duplicate, delete a theme; pick its sets.
- [ ] Activate two themes of the same group one after the other: only one stays active.
- [ ] Rename and delete a set; delete the open set (the view goes back to the overview).

### Values and references

- [ ] *Resolve* selector: an inactive set shows its own values with "This set on top", Penpot's with "Active sets", the theme's with a theme.
- [ ] A broken alias shows "Missing {…}"; a circular one "Circular reference".
- [ ] Rename a referenced token with "Rename and update references": the references follow.
- [ ] Delete a referenced token: the dialog lists the tokens that will break.
- [ ] Move tokens to a set with the same names: skip / keep both / replace.

### Applying tokens

- [ ] Apply with the row button and with the menu; properties already applied show "Applied".
- [ ] Applying a token whose name another active set overrides shows the warning.
- [ ] Selection panel: values, swatches, jump to the token, remove an application.
- [ ] *Select shapes using it* selects the right shapes.

### Import / export / check

- [ ] Export all sets, import the file into a new Penpot file with Penpot's own import: same tokens and themes.
- [ ] Export from Penpot's own panel, import it here (skip and replace modes).
- [ ] Import a single-set file; the set name comes from the file name and can be changed.
- [ ] Download works (needs the `allow:downloads` permission) and Copy works.
- [ ] *Check tokens* lists broken references, applied tokens no active set defines, and file errors; "Select shapes" works, also on another page.

### UI

- [ ] Light and dark Penpot themes, including opening the plugin with Penpot already in dark.
- [ ] Narrow plugin window: header and toolbar don't overlap.
- [ ] Keyboard: set tree (arrows, Enter, context-menu key), menus (arrows, Escape), dialogs (Tab stays inside, Escape closes only the top layer).
- [ ] External changes (Penpot's tokens panel, undo) show up within ~2 s.
- [ ] Preferences survive reopening the plugin: column widths, grouping, collapsed groups, last set.
