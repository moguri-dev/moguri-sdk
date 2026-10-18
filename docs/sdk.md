# Moguri SDK and CLI

Moguri is one importable SDK, with terminal and desktop clients on top. The
service is the only durable writer; the SDK exposes its typed commands,
queries, sequenced events, optimistic revisions and cancellation. Electron does
not own a second agent loop, settings store or provider connection.

This is an alpha API. Protocol 2 deliberately rejects incompatible running
services. Database migration 2 preserves schema-1 history, sessions, drafts,
receipts and blobs. Restart a previously running alpha service explicitly with
`node bin/moguri.mjs service restart`; do not delete its state.

## Build and consume

```bash
npm ci
npm run build
npm pack
```

Install the resulting `moguri-0.2.0-alpha.1.tgz` in a Node 26 consumer with npm.
The package is private and is not published to the npm registry. It includes
compiled SDK modules, declarations, CLI, workers, clients and the pinned local
speech runtime, but no speech weights. Native dependencies must match the
consumer's platform. Use npm's normal dependency installation, not
`--ignore-scripts`, for an operational CLI.
With npm's script allowlist enabled, review `npm install-scripts ls` and approve
this known Moguri package plus its pinned Node/node-pty native installation
steps. A file-tarball dependency is approved by package name rather than a
registry-version selector. Do not approve unused provider lifecycle scripts.

| Import | Surface |
| --- | --- |
| `moguri` | Browser-safe `MoguriSdk`, typed protocol, defaults, `DraftEditor`, ASCII identity |
| `moguri/node` | `connectMoguri`, `createRuntime`, private service discovery and explicit owned-service shutdown |
| `moguri/react` | Renderer-independent `useMoguri` subscription hook |
| `moguri/mcp` | The single outward native MCP server, bound to one session |

`npm run verify:sdk` packs and installs into a separate temporary consumer,
type-checks all four entrypoints without the repository's tsconfig, and runs an
embedded service with real vector retrieval and native MCP discovery. It does
not authorize a personal account, record audio or download model weights.

## Connect to the shared service

```ts
import { connectMoguri } from "moguri/node";

const sdk = await connectMoguri();
try {
  const settings = sdk.settings.get();
  if (!settings) throw new Error("Moguri is not connected.");
  console.log(settings.values.appearance.theme); // dark by default
  const projects = sdk.getState().snapshot?.projects;
  console.log(projects?.map(({ id, name }) => ({ id, name })));
} finally {
  sdk.disconnect();
}
```

Connection metadata contains a private token. Never print it, put it in URLs,
send it to a model or pass it to plugins. Disconnecting a client does not stop
the shared service or its owned work. SDK command IDs are idempotent; a lost
response does not authorize an automatic resend.

Embedding is explicit:

```ts
import { createRuntime, connectMoguri } from "moguri/node";

const stateDir = "/absolute/private/moguri-state";
const runtime = await createRuntime({ stateDir });
const sdk = await connectMoguri({ stateDir, autoStart: false });
try {
  console.log((await sdk.voice.status()).voice.diagnostic);
} finally {
  sdk.disconnect();
  await runtime.close();
}
```

Only embed when no other service owns that directory. Importing the SDK alone
does not start a service or read credentials. Default provider initialization
uses Moguri's OS-keychain backend; generated providers are injected only in tests.

## Shared capability APIs

| Facade | Operations and boundaries |
| --- | --- |
| `settings` / `prompt` | Get, revision-checked update/reset, effective prompt preview. Prompt edits require explicit risk acknowledgement; running turns retain their prompt digest. |
| `memory` | Opt-in index, lexical-vector search, import/symbol graph, explicit project-style facts. Context injection has a separate opt-in. |
| `capabilities` | Import disabled standard skills/plugins, inspect source, toggle with revision, propose, review and decide against an exact SHA-256. |
| `mcp` | Paged tool discovery, non-secret auth status, user-only keychain credential changes, exact approval-bound call, retained result pages. |
| `subagents` | Explicit opt-in, depth-one tool-less child using the same fixed model and approved parent context. |
| `voice` | Local status, explicit licensed download, record/transcribe, stop/finalize and revision-safe draft insertion. |
| `jobs` | Wait or explicitly cancel. A wait timeout/disconnection does not cancel or retry the service's job. |
| `sandbox` | Truthful readiness/configuration diagnostics. Configuration is not proof of a qualified SendBox transport. |

Use `sdk.command` for project/session creation, draft/queue changes, controls,
human approvals, archive/resume and allowed-env policy. These are the same
validated commands used by both clients.

To enable memory, clone `sdk.settings.get().values`, set `memory.enabled`, then
call `settings.update` with the observed revision. `memory.index(projectId)`
returns a job ID. Wait for a terminal job, inspect its status, and use
`mcp.readResult(jobId)` for the retained bounded result. Failure, partial work
and cancellation must not be interpreted as completion.

## Skills, scripts and plugins

Standard skills are `SKILL.md` files with YAML `name` and `description`, followed
by Markdown instructions. Imports start disabled and grant no permissions.
Enabled skills enter the protected prompt as identified project knowledge.
Model proposals retain their model actor and base digest. Human approval
installs disabled content; enabling it is a separate explicit action.

A version-1 plugin is a declarative skill bundle:

```json
{
  "schemaVersion": 1,
  "name": "example-conventions",
  "version": "1.0.0",
  "description": "Project conventions",
  "skills": [
    "---\nname: example-style\ndescription: Explicit result types\n---\nPrefer explicit result types at public boundaries."
  ]
}
```

Enable the plugin before any bundled skill. Disabling the owner prevents its
contents from entering context. Arbitrary JavaScript entrypoints, dependency
installation, marketplace updates and unattended self-modification are not
implemented.

Approved custom scripts are Node modules receiving JSON on stdin:
`{"arguments":{},"projectRoot":"/approved/project"}`. They emit bounded stdout,
must exit, and are exposed as `script.CAPABILITY_ID` through the internal MCP.
They are **unsandboxed Local host code**. Review the exact source, enable it,
then approve each call. The source digest is part of the discovered schema
fingerprint; an old approval cannot silently execute changed content.

## One native MCP

```bash
node bin/moguri.mjs mcp --session SESSION_ID
```

Configure that command as a stdio MCP in another client. It exposes only
`moguri_discover_mcps`, `moguri_find_tools`, `moguri_auth_status`,
`moguri_call_tool` and `moguri_read_result`. It cannot change settings,
credentials, permissions or answer its own approval. Calls wait for the human
in the bound idle session, then retain a paged result.

Backend MCP transports are stdio and Streamable HTTP, using no auth or a scoped
OS-keychain bearer credential. HTTPS is required except explicitly configured
loopback HTTP. Interactive OAuth-only servers are not yet supported. Discovery
is bounded to 512 tools/64 pages, with 20 tools per SDK response. Tool schemas
and server versions are fingerprinted and rechecked at invocation. Credentials
are not forwarded through environment variables to stdio children.

The curated internal MCP exposes `grep_logs`, `fetch_page`, `search_memory` and
`memory_graph`. Page fetching requires approved HTTPS, pins the resolved public
destination, rejects private networks/unsafe redirects and bounds extraction.
Tool descriptions, annotations, output and model recommendations remain
untrusted data, never permission grants.

## CLI entrypoints

`node bin/moguri.mjs --help` lists supported commands. A normally installed
package also supplies the `moguri` executable. `moguri status` exposes project
and session IDs without printing transcripts or connection credentials.
`config`, `prompt`, `memory`, `skills`, `plugins`, `mcp`, `agents`, `dictate`
and `service` are SDK adapters. A published desktop binary is supplied separately;
starting desktop from source requires the development Electron dependency.

The TUI's **Ctrl+G** exposes shared settings. Its JSON editor includes all
sections and rejects stale revisions. **Ctrl+Enter** explicitly acknowledges
prompt risk and saves; **Ctrl+R** restores; **Esc** discards that local editor.
See [setup](setup.md) for terminal commands, dictation and supported limitations.
