# Contributing

This repository holds doola's public browser SDK. External PRs are welcome for
bugs and documentation; API surface changes are driven by the doola team.

## The contract surface

This section is the canonical definition; everything else in the repo points here.

- **Public contract:** `packages/js/src/types.d.ts` (re-exported by `@doola/js`) and `docs/errors.md`. Once
  partners ship against them, every exported name and documented semantic is
  effectively permanent. Review any change as a public-API change: additive is
  fine, breaking requires a major and a migration note, and removals
  effectively never happen. These rules bind from the first published release;
  until then the surface is explicitly unstable and review may reshape it
  without migration notes or changesets. `docs/errors.md` is contract surface —
  changes to it are reviewed as API changes — but where the two files disagree
  on meaning, the `.d.ts` decides and `errors.md` has the bug.
- **The loader outlives every published contract version.** The loader is
  fetched from js.doola.com at runtime, never bundled, so a partner cannot pin
  it: someone who installed `@doola/js` a year ago has last year's types but
  today's loader on every page load. Within one loader URL major (`/v1/`), the
  loader must therefore keep accepting AND honoring the union of every options
  shape any published shim version has ever sent — for as long as any such
  install exists, not just N−1. "Additive only" is the mechanism that makes
  this possible, not politeness: an option removed from the types is still
  being passed by every partner who has not updated. It follows that an npm
  major alone cannot ship a breaking change — old installs still load
  `/v1/doola.js`. A true break is a new loader path (`/v2/doola.js`) with a
  new npm major pointing at it, while `/v1/` keeps serving the old contract
  until telemetry shows no live traffic on it and the sunset has been
  communicated. One concrete instance: the shim injects the loader script
  unconditionally, so the loader's `window.Doola ??= { init }` — first
  evaluation wins — is part of the contract with every shim ever published,
  not a local nicety.
- **Internal but versioned:** `docs/protocol.md`, implemented by
  `packages/protocol` (`@doola/sdk-protocol`). Partners never touch either, but
  the loader and the embedded app deploy independently, so it carries its own
  version and both sides support N−1. The package is published because the app
  lives in `doolahq/doola-sdk-app`, and a wire format maintained in two
  repositories drifts. **Where the document and an implementation disagree, the
  document wins.** `spec-matches-docs.test.ts` notices one slice of that: the
  two must name the same messages and the same version. Payload fields are
  covered from the other side — `SpecOf` makes a field the spec omits a `tsc`
  error — which leaves a document edit to a payload cell as the gap neither
  catches.

Both published surfaces are recorded in `packages/js/etc/js.api.md` and
`packages/protocol/etc/sdk-protocol.api.md`, generated from the built `.d.ts`,
and CI fails when either is stale. When you change the API on purpose, run
`pnpm api:update` and commit the report: its diff is what the reviewer reads as
the API change. It does not show the `Window.Doola` global augmentation in
`packages/js/src/index.ts`, so review that by hand.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …).
- Versioning via [changesets](https://github.com/changesets/changesets): every
  user-facing change includes one (`pnpm changeset`). How a changeset becomes a
  published version, and how the loader bundle reaches js.doola.com, is
  [`docs/releasing.md`](docs/releasing.md).
- `pnpm typecheck` and `pnpm format:check` must pass; CI enforces both.
  `typecheck` also compiles every ` ```ts ` block in the published READMEs
  (`pnpm check:readme`), because partners copy them verbatim. Names an example
  leaves to the partner, such as their auth, are declared in
  `scripts/readme-examples.d.ts`. A block that builds on an earlier one says so
  in a comment above its fence (`<!-- example: payment after session-route -->`),
  so it is compiled against that block rather than against a shared global.
- Node and pnpm versions are pinned in `package.json` (`engines` / `packageManager`) and `.nvmrc` — those are the source of truth, not this file.

## Testing the loader

`pnpm test` is the whole signal. It runs vitest **and** the browser suite, and
`test:browser` builds the bundle first, so no workflow has to remember an extra
step. One local prerequisite it cannot cover: the Chromium binary. Run
`pnpm --filter @doola/loader exec playwright install chromium` once per machine —
CI does it through `.github/actions/playwright`, cached on the resolved version. Keep it that way: `deploy-loader.yml` is the
production live switch and gates on `pnpm test` alone, so splitting the browser
suite back out means a loader can reach the edge without it ever running.

Four rules the suite learned the hard way. Each one is here because a test
passed while the bug it named was live.

- **Freeze the clock, never just install it.** `page.clock.install()` keeps
  ticking with real time, so a test that fast-forwards to just inside a deadline
  can cross it while waiting for the browser, and then passes through the wrong
  timer. Use `freezeClock(page)`.
- **Assert the `message`, not just the `type`.** `render_error` covers three
  different failures and the string is the only one a partner sees. They shared
  one sentence for a while, which sent people to the app's boot sequence when
  the fault was DNS, and hid a protocol skew entirely.
- **Exercise both presentation modes.** `auto` is the default and promotes to a
  fixed overlay under 640px, so anything touching mount, teardown or failure
  behaves differently on a phone. Every deadline test once mounted wide, which
  is how a failed full-screen frame came to leave the page scroll locked.
- **Prove the test fails.** Remove the fix, run the suite, watch it go red, put
  it back. Two of the tests in this repo were written against the wrong window
  and passed with the code deleted.

jsdom cannot host these: it does not enforce `postMessage` targetOrigin, which
is the rule most of them are about. That is why the suite is Playwright and
lives in `test/browser/*.browser.ts` — the extension keeps vitest's default
include from collecting it.

## What does not live here

The embedded application (served from the SDK origin) is built in
`doolahq/doola-sdk-app`, and the loader's deployed bundle is published from
here by CI rather than committed. This repo defines the contract, ships the npm
shim, and owns the protocol both sides speak.
