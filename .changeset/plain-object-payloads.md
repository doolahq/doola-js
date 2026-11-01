---
'@doola/sdk-protocol': patch
---

`parseAppMessage` and `parseLoaderMessage` now refuse a payload, a `session` or an `appearance` that is not a plain object. `postMessage` structured-clones, so a `Date`, `Map`, `Set`, `RegExp` or `Error` used to pass as an empty payload, and an `update` built from one cleared the locale and the branding. The app's hand-written parser already refused these, so the package now matches it, and the app can import the package without losing the check.
