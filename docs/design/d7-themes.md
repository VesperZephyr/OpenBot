# D7: Light and dark appearance

The two themes share composition and identity, with separate surface, text, interaction and state colors. Light is the initial preference; System is an explicit choice. Uploaded images and generated avatar colors retain their identity.

| Role | Light | Dark |
| --- | --- | --- |
| Chat canvas | White `#ffffff` | Soft charcoal `#19181e` |
| Sidebar | Pale lilac `#f4f2f7` | Near-black plum `#141218` |
| Cards / composer | White `#ffffff` | Raised charcoal `#232129` |
| Hover / code / controls | Cool paper `#f6f3f9` | Graphite `#2d2a35` |
| User bubble | Pale lilac `#eee7f6` | Muted plum `#353040` |
| Main text | Plum ink `#30283f` | Warm white `#eeeaf3` |
| Secondary text | Gray plum `#6d6479` | Lavender gray `#b0a8bc` |
| Primary action | Plum `#644689`, white ink | Lavender `#bfa4e5`, dark ink |
| Quote / supporting note | Pale olive, dark olive ink | Dark olive, pale olive ink |

## Application

- Use semantic tokens throughout components, including artifact icons, identity stars, quote blocks, welcome notes, sidebars, focus rings, popovers and destructive actions. Do not depend on raw system media queries inside individual components.
- Dark mode uses lighter surfaces to distinguish the composer, menus and dialogs from the canvas, plus deliberate boundaries. Avoid a purple wash and isolated white cards. Light mode uses white space with subtle borders and restrained shadows.
- Primary and destructive actions have their own ink tokens. Sidebar text, status colors, identity stars and brand marks have distinct light and dark values. Light uses dark ink throughout the sidebar; no dark navigation block remains. Disabled controls remain distinguishable; hover never suggests an unavailable action is enabled.
- Appearance selection uses three miniature previews with a native radio group. Selection persists, follows OS changes only under System, and does not reset conversation drafts or profile edits.
- Verify main and secondary text, primary/destructive action ink, quote text, sidebar status, selected states and input placeholders against their actual rendered backgrounds. Required normal text contrast is at least 4.5:1. Capture matching conversation, profile, Settings and approval states in both themes, including compact Chinese screens.

## Verification surfaces

`e2e/themes.e2e.ts` renders matching light/dark chat, profile, settings, menu, confirmation and approval captures under `e2e/.run/themes/`. It measures actual CSS text/background contrast, including input placeholders and primary/destructive ink. `e2e/chat-interaction.e2e.ts` covers OS changes, persisted selection, compact Chinese screens and the interruption/composer interactions.
