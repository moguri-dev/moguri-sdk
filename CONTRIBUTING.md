# Contributing to the Moguri SDK

Thanks for helping build Moguri. Bug reports, documentation fixes, tests and
code are all welcome. This guide explains how to propose a change and get it
merged.

## Before you start

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in every project space.
- **Security issues:** do not open a public issue. Follow
  [SECURITY.md](SECURITY.md).
- Read the [AI policy](https://github.com/mbianchidev/moguri#ai-policy): you
  are responsible for everything you submit, however it was produced.
- **Coding agents:** read [AGENTS.md](AGENTS.md) before editing anything. It
  holds the repository's binding architecture rules and verified commands.

## Issues and proposals

- Search [existing issues](https://github.com/moguri-dev/moguri-sdk/issues)
  first. Product-wide planning lives in the
  [Moguri desktop repository](https://github.com/mbianchidev/moguri/issues).
- **Bugs:** include the SDK version, your macOS version, the client or
  consumer, the environment (Local, Sandbox or Remote), what you
  expected, and the smallest steps that reproduce it. Use generated data;
  never paste credentials, tokens or private repository content.
- **Features and larger changes:** open an issue describing the problem and
  your proposed approach before writing a large patch. Moguri works in a
  documented phase order, so some ideas wait for earlier milestones.

## Development setup

You need macOS on Apple silicon for the full suite, and Node.js 26 from
[`.node-version`](.node-version).

```sh
npm ci
npm run build
npm run service    # the local service from TypeScript sources
```

The [development guide](docs/development.md) covers the code layout, every
check and debugging. [Releasing](docs/releasing.md) covers the release
process, which only maintainers run.

## Making a change

1. Create a branch from `main` and keep the change focused on one problem.
2. Keep the service authoritative: clients (desktop, TUI, CLI) share this one
   SDK and must not keep client-only state. Expose capabilities through the
   package entrypoints listed in the [development guide](docs/development.md);
   a change to the service API or durable schema bumps `PROTOCOL_VERSION`.
3. Add or update tests that would fail without your change. Use generated
   fixtures only: no real credentials, customer data or personal data.
4. Update the relevant documentation under `docs/` in the same change. Keep
   the README short.
5. Run the checks locally. CI runs only after merging to `main`, not on pull
   requests:

   ```sh
   npm run typecheck
   npm run build
   node --import tsx --test tests/<affected>.test.ts   # focused suites first
   npm test                                            # full suite
   npm run verify:sdk                                  # packed-package check
   npm audit --audit-level=moderate
   ```

6. Write commit messages as short imperative sentences that say what changed,
   for example `Add retry backoff to model recovery`.

## Pull requests

- Describe what changed and why, link the issue, and list the checks you ran
  with their results.
- Call out schema or protocol changes, migrations, new dependencies and their
  licenses ([third-party components](docs/third-party.md)), and the protocol
  version clients need.
- A maintainer reviews every pull request. Address feedback with new commits,
  and reply to each review thread so reviewers can follow the discussion.

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE.md).
