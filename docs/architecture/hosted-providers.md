# Hosted providers and generic endpoints

Moguri reaches models in five ways. All of them go through the same shared
service, SDK, worker loop, cancellation and accounting; only authentication and
discovery differ.

| Connection | Authentication | Discovery |
| --- | --- | --- |
| GitHub Copilot | Copilot device sign-in (unchanged) | Copilot account models |
| Any OpenAI-compatible endpoint | None, bearer key or a key in a named header | `GET /models`, or explicit model IDs only |
| OpenRouter | API key, or Sign in with OpenRouter (mints a user-controlled key) | pi-ai catalogue limited to the key's `GET /models/user` |
| Anthropic API | API key only | pi-ai's maintained Anthropic catalogue |
| OpenAI API | API key | pi-ai's maintained OpenAI catalogue |
| ChatGPT account | Sign in with ChatGPT (OpenAI's supported sign-in for open-source, local apps) | pi-ai's OpenAI catalogue, used under the ChatGPT plan |

Running the full Claude Code or Codex agents is a separate feature; see
[agent harnesses](agent-harnesses.md).

## Hosted accounts

OpenRouter, Anthropic API, OpenAI API and ChatGPT are built on
`@earendil-works/pi-ai` 1.3.0 (MIT): its `openrouter`, `anthropic` and `openai`
providers, their OAuth flows and their locked OAuth refresh. Moguri adds no other
runtime or proxy.

- **Selection.** A provider appears only after the user stores a key or starts a
  sign-in. `settings.hostedProviders` lists connected providers; only listed
  providers read the secret backend, so profiles and tests that never connect one
  never touch the keychain.
- **Credentials.** Keys and OAuth credentials live only in the profile's secret
  backend (`dev.moguri.profile.<id>.models`, slot `hosted.<provider>`), as pi-ai
  credential JSON. Each slot accepts only the methods Moguri offers for that
  provider. Settings, events, snapshots, logs and the renderer never contain them;
  the worker receives the request credential only for one call and redacts it from
  streamed output. There is no ambient environment or file lookup.
- **Account changes.** `models.hosted.key.set`, `models.hosted.login`,
  `models.hosted.remove` record `model.authorization_changed` with the actual user
  command, require no running model work and bump settings. `models.hosted.code`
  and `models.hosted.cancel` affect only an in-progress sign-in.
- **Refresh and expiry.** Every refresh and model preparation resolves auth through
  pi-ai, which refreshes an expiring OAuth credential under the store lock and
  persists the result before use. A failed refresh marks the provider `error` and
  asks the user to sign in again; no other provider is substituted.
- **Model identity.** Models are `hosted.<provider>.<sha256(apiModelId)[:24]>`
  with `source: "hosted"`, the provider as `providerId` and the upstream ID as
  `apiModelId`. Identical upstream IDs from different sources group in the
  catalogue and need an explicit source choice, as for Copilot and local endpoints.
  Hosted models run in the Local Env only.

### OpenRouter

An API key, or Sign in with OpenRouter: pi-ai's PKCE flow listens on an ephemeral
loopback port and exchanges the code for a permanent, user-controlled API key
(not subscription access and not an expiring token). The surfaced sign-in URL must
be `https://openrouter.ai`. The model list is pi-ai's catalogue limited to the
key's `GET /models/user`, with the key's context and output limits.

### Anthropic API

API keys only, billed by the Anthropic API. Claude.ai subscription sign-in is not
offered and subscription credentials are not accepted, per Anthropic's
[authentication and credential-use policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
(checked 2026-11-16): third-party apps must use API keys or supported cloud
providers. pi-ai would send any key containing `sk-ant-oat` as a Claude
subscription OAuth token with Claude Code identity headers, so Moguri refuses such
keys before storage.

### OpenAI API and ChatGPT account

These are separate providers with separate credential slots, so API billing and
ChatGPT plan usage never mix.

- **OpenAI API:** an API key billed by the OpenAI API platform.
- **ChatGPT account:** [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)
  (checked 2026-11-16), which OpenAI documents for open-source and locally hosted
  apps. pi-ai performs the PKCE dynamic-client registration
  (`client_id=dynamic_agent_client`, scope `chatgpt.tokens.use.direct`, resource
  `https://api.openai.com/v1`) with `agent_name_hint=Moguri` and the host ID
  `urn:uuid:<settings.hostedDeviceId>`. The host ID is a UUIDv4 created once per
  profile when ChatGPT is first connected; it is not a credential. The browser
  returns to `http://127.0.0.1:1455/auth/callback`. When the browser cannot reach
  this machine, the user pastes the final redirect URL instead. The sign-in URL
  must be `https://auth.openai.com`. pi-ai omits the request fields that OpenAI's
  [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
  reject. Clients follow OpenAI's UI guidance: the action is "Continue with
  ChatGPT", ChatGPT models say "Using ChatGPT plan" and settings link to
  [ChatGPT usage](https://chatgpt.com/settings/usage).

## Generic OpenAI-compatible endpoints

`settings.localModels` endpoints accept any HTTPS base URL or loopback HTTP and
explicitly configured model IDs, without a provider allowlist. In addition:

- `auth: "header"` with `authHeader` sends the stored key in that header (for
  example `api-key` or `x-api-key`) and removes `Authorization`. Its secret slot is
  bound to the header name, so moving the key to another header needs it entered
  again.
- `headers` adds up to 16 plain, printable request headers. Names that carry
  credentials (`authorization`, `cookie`, or containing key, token, secret,
  password, session, signature or credential) are rejected; use header auth for
  those. Transport headers and duplicates are rejected.
- `discovery: false` skips `GET /models`; exactly the configured IDs become
  available.

Header auth, custom headers and explicit-only endpoints are Local options. They
are not offered to Sandbox (whose network broker sets credentials itself) and are
rejected for SSH model endpoints.

## Clients

Desktop settings / Model providers lists every hosted provider with a masked key
field, sign-in, redirect-URL paste, cancel, refresh and removal. The TUI and every
SDK slash client use `/connect chatgpt|openrouter`, `/api-key
openrouter|anthropic|openai` (TUI masked input), `/login-code chatgpt|openrouter`
(TUI masked input), `/cancel-login PROVIDER` and `/disconnect PROVIDER`; `/connect`
alone still signs in to Copilot.

## Accounting

Hosted models are ordinary Moguri models: budget reservations, provider-reported
usage and estimates work as for Copilot. Provider estimates are not billed cost;
ChatGPT plan usage is managed in ChatGPT.

## Migration

Migration 108 (unreleased in this lineage) also covers `settings.hostedProviders`,
`settings.hostedDeviceId` and the endpoint `auth: "header"`, `headers` and
`discovery` fields: pre-108 lineages cannot contain them.

## Tests

`tests/hosted-providers.test.ts` uses a generated loopback API and an in-memory
secret backend. It stores OpenRouter and Anthropic keys, lists the key's models,
streams through the worker with the right headers, refuses a Claude subscription
token, verifies no key reaches snapshots or events, removes a provider, checks the
OpenRouter and ChatGPT sign-in URLs and host ID, rejects a bad redirect without
storing anything, cancels sign-in and covers endpoint header auth, plain headers,
explicit-only models and credential-header rejection.
