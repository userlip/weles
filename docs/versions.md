# Versions

The version gate (`weles release enforce-version`, run by
`.github/workflows/version-check.yml`) judges a revision against two
documents:

- `released-surface.json` — the surface of the release Stado serves, and its
  version;
- `release/version-change.json` — that release as `current`, and the version
  this tree becomes as `candidate`.

Both are written from what Stado publishes, never by hand:

```
node scripts/release/version/adopt-published.mjs --platform darwin-arm64
npm version <patch|minor|major>
node scripts/release/version/declare-candidate.mjs
```

`adopt-published` reads `stado release status weles-worker --json`, fetches
the served release's signed archive for its exact source revision with
`stado release fetch`, takes `released-surface.json` out of the runtime
payload (`runtime.binary` in `.wisent-release.json`) and records it, with the
served version as both the baseline's version and the declaration's
`current`. The archive and the extracted surface stay under
`.build/published/<product>-<version>-<platform>/`.

It refuses, naming the cause:

- a missing `--platform`;
- a status document that names no served release for that platform;
- targets that desire different releases, each named with its version and
  source revision: adopt once the rollout settles;
- a failed fetch or extraction, with the command and its error;
- a served version older than the recorded baseline, unless the baseline is
  being corrected (`weles release adopt-baseline --correcting`).

`stado release status` also exits nonzero when a target cannot be shown to run
the release it desires; that finding is about the rollout, not about what was
published, so it is repeated on stderr and the read continues.

`declare-candidate` writes the version `npm version` put into `package.json`
as the declaration's `candidate`, and refuses a `package.json` that still names
the served release.

`tests/release/published-baseline.mjs` runs both scripts against the real
Stado in a scratch copy of the checkout under `build/real-tests/`, and checks
that the written baseline names the served version and carries the surface of
the published payload.
