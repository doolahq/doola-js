# Releasing

Two things ship from this repository on two different clocks, and keeping them
apart is the point:

| What                               | Where it goes              | Workflow            |
| ---------------------------------- | -------------------------- | ------------------- |
| `@doola/js`, `@doola/sdk-protocol` | npm                        | `release.yml`       |
| the loader IIFE (`@doola/loader`)  | `js.doola.com/v1/doola.js` | `deploy-loader.yml` |

A partner installs the first and loads the second at runtime, so a loader fix
reaches every page on the next load while a published version stays pinned in
their lockfile until they upgrade. Why that asymmetry is the contract rather
than an accident: CONTRIBUTING.md, "The loader outlives every published
contract version".

## Publishing to npm

Every user-facing change carries a changeset (`pnpm changeset`). Merging that to
`main` opens a **version packages** pull request whose diff is the version bumps
and the changelog entries partners will read; approving and merging it is what
publishes.

Nothing reaches npm without that second merge, which matters because npm is
permanent: the unpublish window is 72 hours and a version number, once used, can
never be reused.

### One-time setup

Neither package exists on npm yet and the `@doola` scope is unclaimed, so the
first release needs these once, in this order:

1. **Create the `@doola` organisation** on npmjs.com. Claim it whether or not
   the first publish is imminent — a scope someone else takes is not
   recoverable, and both package names are already written into the README, this
   repo's docs and doola-sdk-app.
2. **Create an automation access token** with publish rights on the scope, and
   add it as the repository secret `NPM_TOKEN`. Classic _Automation_ is the type
   that works unattended: it is exempt from the 2FA prompt that would otherwise
   stop a CI publish.
3. Nothing else to configure. `access: public` is already set in
   `.changeset/config.json`, which is what lets a scoped package publish
   publicly on the first try.
4. **Once the first version is live**, delete the `NPM_TOKEN`-unset branch in
   `release.yml`. It exists so that a version pull request can still be opened
   before the scope is claimed. Left in afterwards it turns an expired token
   into a green run that published nothing, which is worse than a red one.

### Why `pnpm publish` and not `npm publish`

`@doola/js` resolves to TypeScript source during development and to built `dist`
once published. That rewrite lives in `publishConfig`, which pnpm applies and
npm ignores — under `npm publish` the published package would point at a `.ts`
file no consumer can resolve. Changesets detects the workspace and shells out to
`pnpm publish`, so this is already correct; it is written down because the
failure would only show up in a partner's build.

## Deploying the loader

`main` deploys `development`. `production` is `workflow_dispatch` only, behind
that environment's required reviewer, because the moment the object lands it is
on every partner's page.

Note that `@doola/js` hardcodes `https://js.doola.com/v1/doola.js`, so nothing
loads the development distribution on its own. What makes the development run
worth having is the last step: it fetches the public URL and compares what the
edge serves against what the commit built, so every push to main rehearses the
production path end to end.

A run whose bundle is byte-identical to what the origin already holds skips the
upload, the invalidation and the verification. That is the common case for a
`version packages` merge, which changes manifests and changelogs but not the
loader.

### One-time setup

The IAM roles exist (PENG-6611) and both GitHub Environments exist. What is
missing is the wiring between them — set these as **environment** variables on
`development` and `production`:

| Variable                 | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN`    | that account's `github_ci_doola_sdk_loader_role_arn` output    |
| `LOADER_BUCKET`          | `development-doola-sdk-loader` / `production-doola-sdk-loader` |
| `LOADER_DISTRIBUTION_ID` | the distribution fronting `js.test.doola.com` / `js.doola.com` |
| `LOADER_HOSTNAME`        | `js.test.doola.com` / `js.doola.com`                           |

The distribution id is configured rather than looked up because the deploy role
grants `CreateInvalidation` and `GetInvalidation` on one distribution ARN and no
`ListDistributions` — finding it at runtime would need a permission whose whole
purpose is to be absent. A wrong bucket or distribution needs no assertion in
the workflow for the same reason: the role is scoped to one of each, so a wrong
value is a loud `AccessDenied`.

### Cache behaviour

`/v1/doola.js` is published with `max-age=300, must-revalidate` and the deploy
waits for the CloudFront invalidation to complete. Five minutes is the window in
which a browser still holds the previous loader after a fix; the edge is current
before the workflow reports success. Do not make this immutable — the path is
the contract version, not a build id.
