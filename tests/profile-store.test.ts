import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";

test("profile-scoped views isolate events, same-ID receipts, blob grants and forgetting in one authoritative database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-profile-store-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x68);
  const first = new EventStore(path, key, "generated-shared-master", "default"), second = new EventStore(path, key, "generated-shared-master", "generated-profile-b");
  try {
    const content = "Generated same-content profile grants.", privateContent = first.putBlob("Generated first-profile-only text.");
    first.commit([{ event_type: "capability.saved", profile_id: "default", project_id: "generated-shared-id", payload: { entry: {
      id: "generated-private-entry", projectId: "generated-shared-id", kind: "memory", name: "Generated private A", description: "", contentDigest: privateContent, source: "user", enabled: false, revision: 0, createdAt: "2026-01-01T00:00:00Z",
    } } }], { id: "generated-same-command", digest: "generated-command-digest", result: { id: "generated-result-a" } });
    assert.equal(second.events().length, 0);
    assert.throws(() => second.blob(privateContent), /Missing|deleted/);
    for (const [store, profile] of [[first, "default"], [second, "generated-profile-b"]] as const) {
      const contentDigest = store.putBlob(content);
      store.commit([{ event_type: "capability.saved", profile_id: profile, project_id: "generated-shared-id", payload: { entry: {
        id: "generated-shared-entry", projectId: "generated-shared-id", kind: "memory", name: "Generated shared bytes", description: "", contentDigest, source: "user", enabled: false, revision: 0, createdAt: "2026-01-01T00:00:00Z",
      } } }], profile === "default" ? undefined : { id: "generated-same-command", digest: "generated-command-digest", result: { id: "generated-result-b" } });
    }
    assert.equal(first.receipt("generated-same-command", "generated-command-digest")?.id, "generated-result-a");
    assert.equal(second.receipt("generated-same-command", "generated-command-digest")?.id, "generated-result-b");
    assert.ok(first.events().every((event) => event.profile_id === "default"));
    assert.ok(second.events().every((event) => event.profile_id === "generated-profile-b"));
    first.commit([], undefined, { projects: ["generated-shared-id"] });
    assert.equal(first.events().length, 0);
    assert.equal(second.events().length, 1);
    const retained = second.events()[0]!;
    assert.ok(retained.event_type === "capability.saved");
    assert.equal(second.blob(retained.payload.entry.contentDigest), content);
    assert.throws(() => first.blob(privateContent), /Missing|deleted/);
  } finally { first.close(); second.close(); await rm(directory, { recursive: true, force: true }); }
});
