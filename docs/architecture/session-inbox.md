# Session Inbox and explicit skill loading

## Change contract

This follow-up extends the same reviewed skill/checkpoint change. It reuses
the authoritative attention stream, actual question/approval owners, source
admissions, chat activity, SDK, existing React/OpenTUI clients and Moguri SVG
icons. Node, React, OpenTUI and TypeBox retain their existing MIT licenses.
There is no new dependency, provider, authentication flow or model-owned
permission.

The shared API/schema advances from98 to99. Atomic
`session_inbox_schema=1` and `explicit_skill_load_schema=1` markers preserve
genuine98 admission/checkpoint history, original ciphertext, owners, receipts
and accounting. Missing/corrupt/premature markers and actual future history
must fail without rewriting state. Historical skill-use records stay
inspectable; an upgrade never invents a source load.

## Inbox authority

Inbox is the profile resource immediately after Dashboard. It replaces the
titlebar notification destination and uses the existing active-attention
lifecycle. Each session notification opens its exact surviving session;
project-free and archived sessions keep their own identity. Global GitHub
observations retain their existing independently reviewed destination.

Read acknowledgement does not answer, approve, resume or start a model.
Deleting a notification is a separate actual-user command. It retains an
inactive deletion witness so the same observation cannot be replayed as a new
notification, without cancelling the underlying question, tool or job.
Subsequent genuinely new attention can still appear. Session deletion removes
all of that session's notifications through the authoritative projection and
existing retention boundary; deleting a notification never deletes a session,
artifact or accounting record.

Deletion validates the complete requested ID set against the actual profile
before its atomic event. Stale/foreign/deleted IDs fail explicitly, without a
partial removal or optimistic success. UI failures remain visible. Notification
replay, sound and OS banner delivery remain governed by their original
settings and source checks, not by opening Inbox.

## Explicit skill-load evidence

Discovery, source inspection and mentioning a skill are not loads.
The existing `use_skill` find/load contract remains the model entrypoint.
Loading requires complete actual-user source admission and current ownership,
policy, expiry and revocation checks; the follow-up grants no new privilege.

A successful complete load retains a versioned `skill.loaded` event with the
actual source name, complete body digest/byte count, observed loading time,
actor and exact session/turn, plus the original native call ID when present.
The source-load event and consumed-source provenance commit together.
User-selected draft insertion is still revision checked and atomic. Failed,
cancelled, stale or revoked requests cannot publish a successful load icon.
Diagnostic reads remain diagnostic.

SDK activity and both clients display a named book-icon row from this actual
evidence. The native load operation is not shown twice, and an external MCP
tool's name alone cannot become Moguri source-load provenance. Original
pre99 skill-use/activity history remains honest. Rewind never replays loads
or revives a source grant.

## Desktop layout and access

Keep the existing dark/light tokens, system typography and restrained icon
language. Inbox is ordinary keyboard-accessible resource navigation, not a
new popup. Session links, read acknowledgement and deletion have distinct
names and actions; removal leaves focus on a surviving action or Inbox.

The empty new-chat mascot, heading and guidance are horizontally and
vertically centered in the available chat area. The no-selected-chat welcome
uses the same alignment. Existing composer, sidebar, scrolling and narrow
layouts remain usable; centering does not move a populated conversation.

## Required evidence

Generated tests cover actual skill loading versus discovery/inspection,
complete retained bytes, failed/revoked/cancelled loading, exact native-call
deduplication and restart. Inbox tests cover profile isolation, atomic
concurrent deletion, session deletion, unchanged questions/approvals/budgets,
original-session navigation and no inference on read/delete/open.

Hidden desktop tests exercise Dashboard/Inbox order, keyboard navigation,
answering through the owning session, independent deletion, live session
removal, actual skill icons and measured centering at wide/narrow sizes.
Packed external SDK/CLI/TUI checks preserve browser-safe root/React exports.
Changed native protocol bytes need their own matching-image qualification,
not the preceding protocol98 receipts.

## Prerequisites

Before feature edits, the generated macOS arm64 foundation spike passed
provider/streaming in 1,094.87 ms (cancellation 31.55 ms), SQLite in 67.61 ms
(append p95 0.061 ms; rebuild 0.521 ms), PTY cancellation in 151.96 ms with
zero known survivors, OpenTUI in 16.87 ms/update, hidden Electron in
177.17 ms startup/441.36 MiB/8.00 ms scroll, and generated search/Git in
0.920/5.741 ms. The separate session spike retained 500 events and 250
independent artifacts in 112.27 ms and ran real hidden Ghostty WASM in 26 ms.
The foundation script's static live/Rust/Linux/release/native-unavailable
markers remain failed/unqualified; its exit status is not blanket acceptance.
