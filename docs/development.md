# Development

This guide is for contributors working on the Moguri SDK. Coding agents also
follow [`AGENTS.md`](../AGENTS.md), which holds the repository's binding
architecture rules.

## Toolchain

- macOS on Apple silicon runs the full suite. Linux runs the portable
  foundation only; it is not release qualification.
- Node.js 26, pinned in [`.node-version`](../.node-version). `package.json`
  enforces it with `engine-strict`.
- npm (bundled with Node). Dependencies are pinned exactly (`save-exact`).
- Git, and the GitHub CLI (`gh`) for GitHub workflows and releases.
- `rg` (ripgrep) on `PATH`: the service's lean file tools run it, and their
  tests need it. The native dependency cache tests also need Go, Cargo and
  Python 3.11+ with pip. Cargo must be a standalone toolchain, not a rustup
  proxy: the cache runs it with a private `HOME`.
- Apple `container` only for Sandbox images and native qualification.

## Setup and running

```sh
npm ci
npm run build
npm run service        # the local service from TypeScript sources
```

State goes to `~/Library/Application Support/Moguri` unless
`MOGURI_STATE_DIR` points to a private directory; use a separate one for
development.

## Code layout

| Path | Contents |
| --- | --- |
| `apps/service` | The local control plane: event store, controller, model and tool workers, MCP gateway, PTY broker, environments and updater |
| `packages/protocol` | Shared TypeBox schemas, events and domain types |
| `packages/sdk`, `packages/client` | The SDK entrypoints and transport client; root and React entrypoints are browser-safe |
| `scripts` | Build, Sandbox distribution, spikes and qualification tooling |
| `tests` | Node test runner suites and generated fixtures |
| `docs` | SDK reference, architecture and decisions |

## Package entrypoints

| Export | Contents |
| --- | --- |
| `@moguri-dev/sdk` | Browser-safe typed client, protocol schemas and helpers |
| `@moguri-dev/sdk/node` | Service discovery, startup and the lazily loaded in-process runtime |
| `@moguri-dev/sdk/react` | React bindings |
| `@moguri-dev/sdk/mcp` | The gateway MCP server |
| `@moguri-dev/sdk/remote-bridge` | The SSH worker bridge (also the `moguri-worker` bin) |
| `@moguri-dev/sdk/sandbox-distribution` | Builds the bundled Sandbox distribution for packaging clients |
| `@moguri-dev/sdk/testing` | Unstable test support for client repositories: service internals their suites drive directly. Not a supported API |

Clients must import only these entrypoints. Service bundles resolve their
workers next to themselves in `dist/`, so new runtime bundles belong there.

## Checks

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript for the service, SDK and tests |
| `npm run build` | Bundles, SDK types and `dist/THIRD_PARTY_NOTICES.md` |
| `npm test` | Full Node suite. Run `npm run build` first: some tests execute `dist` bundles. `MOGURI_TEST_SHARD=1/3` runs one shard |
| `node --import tsx --test tests/<name>.test.ts` | One or more focused suites |
| `npm run test:latency` | Only the suites that carry product latency budgets |
| `npm run verify:sdk` | Packs the package and checks every entrypoint in an external consumer |
| `npm audit --audit-level=moderate` | Dependency audit |

Tests use generated fixtures only: no real credentials, personal data,
microphones or live provider logins. Fresh macOS checkouts need
`npm exec -- playwright install chromium` once.

## Continuous integration

[`ci.yml`](../.github/workflows/ci.yml) runs only on pushes to `main`. Audit
and typecheck run once on Ubuntu. `npm test` runs on macOS and Ubuntu, split
into three shards per OS, because one shared macOS runner needs about 100
minutes for the whole suite. `MOGURI_TEST_SHARD=<n>/3` passes `--test-shard`
to Node, which assigns test files round-robin in glob order, so the shards
partition the suite exactly; leave it unset to run everything. `verify:sdk`
runs in its own macOS job, because its packed-consumer checks start Local
sessions, and also reports the product latency budgets (below). CI uses four
macOS runners at a time: three shards and that job. Run the relevant checks
locally before opening a PR.

Shared runners run the suite several times slower than a developer Mac, so CI
separates two kinds of timing ([#1](https://github.com/moguri-dev/moguri-sdk/issues/1)):

- **Harness deadlines** (`waitFor`, per-test timeouts, local polling loops,
  subprocess timeouts and wall clocks a fixture chooses for product policy)
  are wrapped in `ciTime()` from `tests/fixtures/time-scale.ts`, and CI sets
  `MOGURI_TEST_TIME_SCALE=4` to stretch them, for `npm test` and `verify:sdk`
  alike. Plain `.mjs` scripts and fixtures define the same one-line helper.
  Wrap new ones the same way, clamping fixture policy limits to their schema
  maximum.
- **Product latency budgets** go through `assertLatencyBudget` or
  `assertOperationLatency` in `tests/fixtures/latency-budgets.ts`. They are
  enforced by default, so they stay hard gates locally, including the
  `verify:sdk` run before tagging a release. `MOGURI_LATENCY_BUDGETS=skip`
  makes the assertions no-ops in the test shards, while the rest of each test
  still runs. The macOS `verify-sdk` job runs `verify:sdk` and
  `npm run test:latency`, and the tag workflow runs `verify:sdk`, all with
  `MOGURI_LATENCY_BUDGETS=report`.
  `scripts/latency-report.mjs` turns every recorded sample into the step
  summary and every miss into a warning.
  A reported miss is a regression to investigate; never raise a budget or
  retry a sample to clear it.

The tag-triggered
[`release.yml`](../.github/workflows/release.yml) publishes releases; see
[releasing](releasing.md).

## Documentation

Put durable documentation under `docs/` and update the relevant SDK or
architecture page in the same change. Keep the [README](../README.md) short.
