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
  communicated.
- **Internal but versioned:** `docs/protocol.md`. Partners never touch it, but
  the loader and the embedded app deploy independently, so it carries its own
  version and both sides support N−1.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …).
- Versioning via [changesets](https://github.com/changesets/changesets): every
  user-facing change includes one (`pnpm changeset`).
- `pnpm typecheck` and `pnpm format:check` must pass; CI enforces both.
- Node and pnpm versions are pinned in `package.json` (`engines` / `packageManager`) and `.nvmrc` — those are the source of truth, not this file.

## What does not live here

The embedded application (served from the SDK origin) and the loader's deployed
bundle are built elsewhere. This repo defines the contract and ships the npm shim.
