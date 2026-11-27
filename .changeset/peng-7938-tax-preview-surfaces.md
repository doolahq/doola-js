---
'@doola/sdk-protocol': minor
---

`PreviewSurface` now names the tax module's three preview surfaces next to `onboarding` and `dashboard`: `tax-onboarding` (its onboarding steps), `tax-questionnaire` and `tax-status` (the tax status card). The portal can send them in `update.preview`, and the app can switch on them. An app that does not know them yet shows `onboarding`, as for any name it has not met, so the branding still repaints.

No protocol bump and no runtime change: `parseLoaderMessage` already accepted any string there.
