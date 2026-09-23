---
'@doola/js': patch
---

Fix the types for CommonJS consumers. On `moduleResolution: node16` or
`nodenext`, `import { loadDoola } from '@doola/js'` in a CommonJS project failed
with TS1479 because `require` resolved to the ES module declarations. It now
resolves to `dist/index.d.cts`. No runtime or API change.
