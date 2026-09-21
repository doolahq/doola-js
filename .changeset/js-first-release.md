---
'@doola/js': minor
---

First published release of the loader shim: `loadDoola()`, the `<doola-embed>`
mount, the `fetchAccessToken` session boundary and the `DoolaError` codes, with
the full public contract in `src/types.d.ts`.

`0.1.x` rather than `1.0.0` on purpose. The surface is what partners will pin
forever once it is stable, and nothing has integrated against it yet — the
minor series says so, and buys room to reshape it before the guarantees in
CONTRIBUTING.md ("additive is fine, removals effectively never happen") start
binding.
