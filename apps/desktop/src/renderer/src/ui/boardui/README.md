# BoardUI import

Upstream: <https://github.com/BoardUI/boardui/tree/ec5c5eb3e29c2441be63b9422cd54f411ef23466>

Commit `ec5c5eb3e29c2441be63b9422cd54f411ef23466` (2026-10-03, `Export from boardui bf69775`). The root `LICENSE` is MIT, SHA-256 `7a28c78354f8f88d8773f72bf37fb9c037817f8abd2fa5a63694d6c946a5ce80`. These hashes are the original bytes, before the adaptations below.

| File | Original SHA-256 | Why it changed |
| --- | --- | --- |
| `components/base/buttons/button.tsx` | `b147c988c73dd8c226ab6ede3d7019eac9a7125191bbd646fcdd25bea803ca41` | Dropped the directional-icon helper, link export and unused variants. Neutral styles only. Icons are React nodes. Action rows wrap instead of a fixed nowrap height. |
| `components/base/select/select.tsx` | `c56abf0ad7b554a363a6e2b46045489b6a94c18718324cbf06e64edf0540b116` | Relative imports, no client directive, omit undefined `items`, visible React Aria label, OpenBot chevron slot, `ob:` classes, portal marker. |
| `components/base/radio/radio.tsx` | `2d0d68454e0dfb9a836fc5f76089ea602aeaf427517885ddff2b568ac2a691ec` | Relative imports, no client directive, accent indicator instead of the blue ramp, `ob:` classes. |
| `components/base/radio/radio-card.tsx` | `ebb32d094fafa5a79e73d3a0d68f40763326f7995e26c75ed1464b85868580a3` | Optional preview slot, labels are not truncated, `ob:` classes. |
| `components/base/dropdown/menu-styles.ts` | `98673114fe832b05991f61a84728873a5d3985fd382e66523958321572ab63db` | `ob:` classes and OpenBot surface tokens. |
| `utils/cx.ts` | `db35ea5afa8b2e0fd51319bc49288c4df7c98ec53440b43903636a32e3319d9d` | `ob` prefix and only the typography aliases this pilot uses. |
| `utils/use-dismiss-on-outside-press.ts` | `01c70c3b25018e9c8d1d6d84ca67facb9392b5d4baf1c7207bbcfe13d4b33699` | Removed the client directive. The outside-press and trigger-toggle behavior is unchanged. |

Direct dependencies, exact: `react-aria-components@1.17.0` (Apache-2.0), `tailwind-merge@3.6.0` (MIT), `tailwindcss@4.3.3` (MIT), `@tailwindcss/vite@4.3.3` (MIT). Tailwind and its Vite plugin are build tools. React Aria and tailwind-merge notices are copied with the renderer.
