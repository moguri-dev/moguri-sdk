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
| `npm test` | Full Node suite. Run `npm run build` first: some tests execute `dist` bundles |
| `node --import tsx --test tests/<name>.test.ts` | One or more focused suites |
| `npm run verify:sdk` | Packs the package and checks every entrypoint in an external consumer |
| `npm audit --audit-level=moderate` | Dependency audit |

Tests use generated fixtures only: no real credentials, personal data,
microphones or live provider logins. Fresh macOS checkouts need
`npm exec -- playwright install chromium` once.

## Continuous integration

[`ci.yml`](../.github/workflows/ci.yml) runs only on pushes to `main`, on
macOS and Ubuntu: audit, typecheck, build, `npm test` and `verify:sdk`. Run the
relevant checks locally before opening a PR. The tag-triggered
[`release.yml`](../.github/workflows/release.yml) publishes releases; see
[releasing](releasing.md).

## Documentation

Put durable documentation under `docs/` and update the relevant SDK or
architecture page in the same change. Keep the [README](../README.md) short.
