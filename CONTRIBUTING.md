# Contributing

This repository holds doola's public browser SDK. External PRs are welcome for
bugs and documentation; API surface changes are driven by the doola team.

## The rule that dominates everything else

`packages/js/src/index.ts` is a public contract. Once partners ship against it,
every exported name is effectively permanent. Review any change to it as a
public-API change: additive is fine, breaking requires a major and a migration
note, and removals effectively never happen.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …).
- Versioning via [changesets](https://github.com/changesets/changesets): every
  user-facing change includes one (`pnpm changeset`).
- `pnpm typecheck` and `pnpm format:check` must pass; CI enforces both.
- Node ≥ 20, pnpm 9.

## What does not live here

The embedded application (`sdk.doola.com`) and the loader's deployed bundle are
built elsewhere. This repo defines the contract and ships the npm shim.
