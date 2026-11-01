---
'@doola/sdk-protocol': minor
---

`parseAppMessage` and `parseLoaderMessage` now refuse a payload, a `session` or an `appearance` that is not a plain object. `postMessage` structured-clones, so a `Date`, `Map`, `Set`, `RegExp` or `Error` used to pass as an empty payload, and an `update` built from one cleared the locale and the branding. The app's own parser already refused these payloads and appearances, so the app can now import the package without losing that check.

New: `isSupportedVersion(v)`, the version rule both parsers apply. The loader uses it to tell a peer it cannot talk to from a message it could not read.
