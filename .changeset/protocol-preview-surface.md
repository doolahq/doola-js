---
'@doola/sdk-protocol': minor
---

`update` now carries `preview`, the surface the partner portal's branding preview shows, and the new `PreviewSurface` type names the two it has today: `onboarding` and `dashboard`. `parseLoaderMessage` accepts any string there, so a surface the portal learns before the app does still repaints the branding, and it drops the whole `update`, branding included, when `preview` is anything other than a string. The portal already sends this field and the app already reads it, each from a hand-typed copy; with it in the package, both can import it instead.

No protocol bump. The field is optional, a peer that does not know it ignores it, and the loader never sends it.
