# Contributing

This repository holds doola's public browser SDK. External PRs are welcome for
bugs and documentation; API surface changes are driven by the doola team.

## The contract surface

This section is the canonical definition; everything else in the repo points here.

- **Public contract:** `packages/js/src/index.d.ts` and `docs/errors.md`. Once
  partners ship against them, every exported name and documented semantic is
  effectively permanent. Review any change as a public-API change: additive is
  fine, breaking requires a major and a migration note, and removals
  effectively never happen. These rules bind from the first published release;
  until then the surface is explicitly unstable and review may reshape it
  without migration notes or changesets.
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
