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
publishes. That merge runs the `publish` job, which waits on the `production`
Environment's reviewer before anything reaches the registry, so npm needs two
approvals: the version pull request and the deployment. Nothing else asks for
the second one — the job runs only when the tree holds a version the registry
does not, so an ordinary merge to `main` queues no deployment at all.

Nothing reaches npm without that second merge, which matters because npm is
permanent: the unpublish window is 72 hours and a version number, once used, can
never be reused.

### One-time setup

1. **A Trusted Publisher on each package, on npmjs.com.** There is no npm token:
   the publish job's GitHub OIDC token is the credential, and npm accepts it only
   from the workflow and Environment registered here. On each of `@doola/js` and
   `@doola/sdk-protocol`, under _Settings → Trusted publishing → GitHub Actions_:

   | Field             | Value         |
   | ----------------- | ------------- |
   | Organization      | `doolahq`     |
   | Repository        | `doola-js`    |
   | Workflow filename | `release.yml` |
   | Environment       | `production`  |

   Renaming `release.yml` or the `production` Environment breaks publishing until
   this is updated to match. A new published package needs its own entry before
   its first release.

   Trusted publishing also makes npm attach a **provenance attestation** to every
   version: the npm page links the exact commit and workflow run that built it.

   Once a release has gone out this way, set each package's _Publishing access_ to
   **Require two-factor authentication and disallow tokens**, so a leaked token can
   never publish, and revoke the old `gha-doola-js-publish` automation token and the
   `NPM_TOKEN` secret it lived in (on the `production` Environment). The first two
   releases, `0.1.0` and `0.1.1`, were published with that token and carry no
   provenance.

2. **The `doola-semantic-release` App with access to this repository**, and its
   key as environment secrets. This is the identity partners-portal already
   releases under.
   - Create a `release` Environment: deployment branches limited to one branch
     rule for `main`, no required reviewers, admin bypass off. The ungated
     `version` job reads the key from here.
   - Add `SEMANTIC_RELEASE_APP_ID` and `SEMANTIC_RELEASE_APP_PRIVATE_KEY` as
     secrets on **both** `release` and `production`. The `publish` job mints its
     own token for tags and GitHub releases, and it runs under `production`.
   - Not org secrets: an org secret is readable by any branch of every repo it
     reaches. An empty `client-id` at a job's first step means that job's
     environment is missing the key.
3. Nothing else to configure. `access: public` is already set in
   `.changeset/config.json`, which is what lets a scoped package publish
   publicly on the first try.

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

| Variable                 | `development`                                               | `production`                                                |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN`    | `arn:aws:iam::394540956281:role/github-ci-doola-sdk-loader` | `arn:aws:iam::576249115295:role/github-ci-doola-sdk-loader` |
| `LOADER_BUCKET`          | `development-doola-sdk-loader`                              | `production-doola-sdk-loader`                               |
| `LOADER_DISTRIBUTION_ID` | the distribution fronting `js.test.doola.com`               | the one fronting `js.doola.com`                             |
| `LOADER_HOSTNAME`        | `js.test.doola.com`                                         | `js.doola.com`                                              |

Both roles carry the same name; the account id is the whole difference, since
`development` and `production` are separate AWS accounts.

The distribution id is configured rather than looked up because the deploy role
grants `CreateInvalidation` and `GetInvalidation` on one distribution ARN and no
`ListDistributions` — finding it at runtime would need a permission whose whole
purpose is to be absent. A wrong bucket or distribution needs no assertion in
the workflow for the same reason: the role is scoped to one of each, so a wrong
value is a loud `AccessDenied`.

## Going live

Neither `sdk.doola.com` nor `js.doola.com` has a not-ready gate: each serves
whatever was last deployed to it, and each deploy verifies its own files from
the edge. A production deploy is therefore the live switch, with that
environment's required reviewer as the only thing in front of it.

The order still matters, because the two deploy independently and `@doola/js`
hardcodes `https://js.doola.com/v1/doola.js`:

1. Deploy the embedded app to production (doola-sdk-app). It must already
   understand every message the loader about to ship can send.
2. Deploy the loader to production, from here.
3. Publish `@doola/js`. Last, because it is the only irreversible step (a
   version number, once used, can never be reused), and by then every URL it
   depends on is already serving.

Publishing before step 2 hands the first partner who installs a loader that
does not yet do what the new types promise.
