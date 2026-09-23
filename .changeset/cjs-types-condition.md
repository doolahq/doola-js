---
'@doola/js': patch
---

Give CommonJS consumers their own type declarations. Both `import` and `require`
resolved to `dist/index.d.ts`, which the package's `"type": "module"` makes an
ES module, so a CommonJS project on `moduleResolution: node16` or `nodenext`
failed `import { loadDoola } from '@doola/js'` with TS1479 even though the
`require` it compiles to works. `require` now resolves to `dist/index.d.cts`,
which the build already emitted. No runtime or API change.
