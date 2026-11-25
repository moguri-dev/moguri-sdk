# Moguri SDK

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
![Platform: macOS arm64](https://img.shields.io/badge/platform-macOS%20arm64-lightgrey.svg)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

`@moguri-dev/sdk` is the shared foundation of [Moguri](https://github.com/moguri-dev),
a model-agnostic AI harness for engineering work. It contains the typed SDK,
the local control-plane service that owns every session, and the service's
model, tool, MCP, terminal, document and SSH workers. The Moguri desktop app
and terminal UI are clients of this package.

> [!NOTE]
> This is an **alpha** for macOS on Apple silicon (Node.js 26). The source,
> releases and package are public. GitHub Packages still needs a token to
> install any npm package, and nothing is on npmjs yet.

## Install

The package lives on the GitHub Packages npm registry, which always needs a
classic token with `read:packages`:

```sh
echo "@moguri-dev:registry=https://npm.pkg.github.com" >> .npmrc
npm install --save-exact @moguri-dev/sdk@0.32.0-alpha.5
```

Put the token in your user `~/.npmrc` (`//npm.pkg.github.com/:_authToken=...`)
or `NODE_AUTH_TOKEN`, never in a committed file.

## Use

```ts
import { MoguriSdk } from "@moguri-dev/sdk";            // browser-safe client
import { connectMoguri, createRuntime } from "@moguri-dev/sdk/node";
import { useMoguri } from "@moguri-dev/sdk/react";       // optional React bindings
import { createGatewayMcpServer } from "@moguri-dev/sdk/mcp";
```

SSH hosts run the versioned worker bridge with the `moguri-worker` command
(`moguri-worker --stdio`). The [SDK reference](docs/sdk.md) documents every
API.

## Documentation

- [SDK reference](docs/sdk.md)
- [Architecture](docs/architecture/overview.md) and [decisions](docs/architecture/decisions.md)
- [Development](docs/development.md) and [releasing](docs/releasing.md)
- [Third-party components](docs/third-party.md)

## Contributing, security and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Moguri's own code is MIT licensed
([LICENSE.md](LICENSE.md)); bundled third-party code keeps its own licenses,
listed in `dist/THIRD_PARTY_NOTICES.md`.
