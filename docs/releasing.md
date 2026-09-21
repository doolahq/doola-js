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

Neither package exists on npm yet, so the first release needs these once:

1. **An npm automation token — already configured.** `NPM_TOKEN` is a
   repository secret on this repo. Classic _Automation_ is the type that works
   unattended: it is exempt from the 2FA prompt that would otherwise stop a CI
   publish. This is the only credential the release needs that the release App
   cannot provide — publishing to npm is not something a GitHub App can do.

   Where it sits is still open. Every other credential here reaches CI through
   OIDC into an Environment pinned to `main`, and production adds a named
   reviewer; this one is repository-scoped, so any workflow run on any branch
   can read it, and the release job declares no `environment:`, so publishing
   needs no approval. That is backwards: a bad loader deploy expires from the
   edge in minutes, a bad publish is permanent in every lockfile. Moving the
   secret onto an Environment and gating the publish closes both halves, and
   npm Trusted Publishing removes the token altogether (PENG-6617).

2. **The `doola-semantic-release` App with access to this repository**, and its
   two org secrets (`SEMANTIC_RELEASE_APP_ID`, `SEMANTIC_RELEASE_APP_PRIVATE_KEY`)
   visible to it. This is the identity partners-portal already releases under;
   if those secrets are scoped to selected repositories, doola-js needs adding.
3. Nothing else to configure. `access: public` is already set in
   `.changeset/config.json`, which is what lets a scoped package publish
   publicly on the first try.
4. **Once the first version is live**, delete the `NPM_TOKEN`-unset branch in
   `release.yml`. It exists so that a version pull request can still be opened
   before the scope is claimed, and with the secret configured it is already
   unreachable here — so it protects against a deleted secret, never an expired
   one, which fails at publish as it should. Left in afterwards it is only a way
   for a release to go green having published nothing, which is worse than red.

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

A run skips the upload, the invalidation and the verification only when the
origin already holds this bundle with the expected headers **and** the public
URL already serves it. That is the common case for a `version packages` merge,
which changes manifests and changelogs but not the loader. Checking the edge
too is what makes a re-run the repair for a deploy that uploaded and then
failed to invalidate or verify.

### One-time setup

The IAM roles exist (PENG-6611), both GitHub Environments exist, and the
variables below are set on each. Nothing here is outstanding; they are written
down because a wrong value is how this breaks.

| Variable                 | `development`                                               | `production`                    |
| ------------------------ | ----------------------------------------------------------- | ------------------------------- |
| `AWS_DEPLOY_ROLE_ARN`    | that account's `github_ci_doola_sdk_loader_role_arn` output |
| `LOADER_BUCKET`          | `development-doola-sdk-loader`                              | `production-doola-sdk-loader`   |
| `LOADER_DISTRIBUTION_ID` | the distribution fronting `js.test.doola.com`               | the one fronting `js.doola.com` |
| `LOADER_HOSTNAME`        | `js.test.doola.com`                                         | `js.doola.com`                  |

The distribution id is configured rather than looked up because the deploy role
grants `CreateInvalidation` and `GetInvalidation` on one distribution ARN and no
`ListDistributions` — finding it at runtime would need a permission whose whole
purpose is to be absent. A wrong bucket or distribution needs no assertion in
the workflow for the same reason: the role is scoped to one of each, so a wrong
value is a loud `AccessDenied`.

## Going live

`js.doola.com` has no not-ready gate, unlike `sdk.doola.com`. Both answer 403
today, but for reasons that behave differently: the app's comes from the
`<env>-partner-sdk-shell-not-ready` CloudFront function and survives a deploy,
while the loader's comes from an empty bucket and disappears the moment one
runs. A production loader deploy is therefore the live switch, with that
environment's required reviewer as the only thing in front of it.

That is a decision rather than an oversight. The loader is inert alone — it
injects an iframe against the SDK origin, which is still gated — so a blanket
403 in front of it protects nothing, and it would break the edge verification
that is the only proof a deploy actually reached anyone.

What it does mean is that the launch order matters, because `@doola/js`
hardcodes `https://js.doola.com/v1/doola.js`:

1. Deploy the embedded app to production (doola-sdk-app). Still dark behind the
   not-ready function.
2. Deploy the loader to production, from here. `js.doola.com` goes live and
   nothing points at it yet.
3. Drop the not-ready function association on the app distribution, in
   doolahq/infrastructure. The frame now renders.
4. Publish `@doola/js`. Last, because it is the only irreversible step — a
   version number, once used, can never be reused — and by then every URL it
   depends on is already serving.

Publishing before step 2 hands the first partner who installs a 403 for the
loader; before step 3, a frame that never renders.

### Cache behaviour

`/v1/doola.js` is published with `max-age=300, must-revalidate` and the deploy
waits for the CloudFront invalidation to complete. Five minutes is the window in
which a browser still holds the previous loader after a fix; the edge is current
before the workflow reports success. Do not make this immutable — the path is
the contract version, not a build id.
