# Releasing the SDK

`@moguri-dev/sdk` is published to the GitHub Packages npm registry
(`https://npm.pkg.github.com`) and as a GitHub release with the packed tarball
and its SHA-512. Both stay private until the owner opens the repository.

## Versions

- [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Prerelease versions
  (for example `0.32.0-alpha.1`) publish under the npm dist-tag `alpha` and as
  a GitHub prerelease; stable versions use `latest`.
- The SDK, the desktop app and the terminal UI version independently.
  `PROTOCOL_VERSION` is their compatibility contract: any service API or
  durable schema change bumps it, because clients reuse a healthy service only
  when protocols match.

## Steps

1. Update `version` in `package.json` and `package-lock.json` on a branch, run
   the full local checks (`npm ci`, `npm audit --audit-level=moderate`,
   `npm run typecheck`, `npm run build`, `npm test`, `npm run verify:sdk`) and
   merge it.
2. Tag the merge commit `v<version>` (annotated) and push the tag.
3. [`release.yml`](../.github/workflows/release.yml) rebuilds on macOS,
   verifies the packed tarball in an external consumer, publishes it to GitHub
   Packages with the matching dist-tag, and creates the GitHub release with the
   tarball and `SHA512SUMS`. It does not rerun the full suite: that runs
   locally before tagging and on `main` CI, and macOS Actions minutes are
   scarce.

When Actions cannot run, a maintainer may publish the same tag locally with
`npm publish --tag <dist-tag>` from a clean checkout of the tag after the
checks above, then upload the tarball and its SHA-512 to the release. The
token must be a classic token with `write:packages`. If the tag workflow runs
later, it re-verifies the tag and leaves an existing package version and
release unchanged.

## Consumers

Clients pin the exact version and keep lockfile `sha512` integrity. Their
project `.npmrc` maps `@moguri-dev` to `https://npm.pkg.github.com`; the token
stays in the user `~/.npmrc` or `NODE_AUTH_TOKEN`. GitHub Packages requires a
token even for public packages, so public installs will need npmjs.
