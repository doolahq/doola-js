# @doola/js

[![npm](https://img.shields.io/npm/v/@doola/js)](https://www.npmjs.com/package/@doola/js)
[![CI](https://github.com/doolahq/doola-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/doolahq/doola-js/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/doolahq/doola-js/badge)](https://scorecard.dev/viewer/?uri=github.com/doolahq/doola-js)
[![license](https://img.shields.io/npm/l/@doola/js)](https://github.com/doolahq/doola-js/blob/main/LICENSE)

Loader injection and TypeScript types for the doola embedded SDK.
See the [repository README](../../README.md) for the integration guide.

This package contains **no UI and no business logic** — small enough to audit in
one sitting, on purpose. The embedded application is served from the SDK origin
(`sdk.doola.com` by default) and is not distributed through npm.
