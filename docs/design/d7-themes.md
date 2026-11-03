# D7: Light and dark appearance

The two themes share composition and identity, with separate surface, text, interaction and state colors. Light is the initial preference; System is an explicit choice. Uploaded images and generated avatar colors retain their identity. D12b replaced the earlier plum accent: the workspace is a neutral gray with white cards, and blue is used for primary actions, toggles and send.

| Role | Light | Dark |
| --- | --- | --- |
| App background | Cool gray `#e8eaee` | Near-black `#101114` |
| Cards / sidebar / chat | White `#ffffff` | Raised charcoal `#1c1d22` |
| Hover / code / controls | Cool gray `#f3f4f6` | Graphite `#2a2c33` |
| User bubble | Cool gray `#f3f4f6` | Graphite `#2a2c33` |
| Main text | Neutral ink `#1c1d21` | Off-white `#f4f5f7` |
| Secondary text | Gray `#5c6370` | Cool gray `#c0c4cc` |
| Primary action | Blue `#1d4ed8`, white ink | Blue `#1d4ed8`, white ink |
| Quote / supporting note | Neutral gray, neutral ink | Graphite, off-white ink |

## Application

- Use semantic tokens throughout components, including artifact icons, identity stars, quote blocks, welcome notes, sidebars, focus rings, popovers and destructive actions. Do not depend on raw system media queries inside individual components.
- Dark mode uses lighter card surfaces against the app background. Light mode uses white cards on a gray app background, with shadow instead of divider lines. Color in the conversation is reserved for Bot avatars; blue is the primary action.
- Primary and destructive actions have their own ink tokens. Sidebar text, status colors, identity stars and brand marks have distinct light and dark values. Light uses dark ink throughout the sidebar; no dark navigation block remains. Disabled controls remain distinguishable; hover never suggests an unavailable action is enabled.
- Appearance selection uses three miniature previews with a native radio group. Selection persists, follows OS changes only under System, and does not reset conversation drafts or profile edits.
- Verify main and secondary text, primary/destructive action ink, quote text, sidebar status, selected states and input placeholders against their actual rendered backgrounds. Required normal text contrast is at least 4.5:1. Capture matching conversation, profile, Settings and approval states in both themes, including compact Chinese screens.

## Verification surfaces

`e2e/themes.e2e.ts` renders matching light/dark chat, profile, settings, menu, confirmation and approval captures under `e2e/.run/themes/`. It measures actual CSS text/background contrast, including input placeholders and primary/destructive ink. `e2e/chat-interaction.e2e.ts` covers OS changes, persisted selection, compact Chinese screens and the interruption/composer interactions.
