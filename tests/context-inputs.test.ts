import { ciTime } from "./fixtures/time-scale.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };
const generatedImage = () => sharp({ create: { width: 16, height: 12, channels: 4, background: { r: 42, g: 91, b: 60, alpha: 1 } } }).png().toBuffer();
test("explicit client-file snapshots work without a project, remain immutable and never grant another session access", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const path = join(fixture.directory, "generated-client.txt"); await writeFile(path, "Generated client original.\n");
    const created = await sdk.sessions.create(null);
    await sdk.attachments.file(created.id!, path);
    let session = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
    const attachment = session.draft.attachments[0]!;
    assert.equal(attachment.kind, "local_file");
    await assert.rejects(() => sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "", attachments: [attachment] }), /not authorized/);
    await writeFile(path, "Generated changed source.\n");
    await sdk.sessions.configure(session.id, { ...session.controls, modelId: fixture.modelId });
    session = sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!;
    const editor = new DraftEditor(sdk, session.id, session.draft);
    try { editor.edit("Generated selected client context."); await editor.send("queue"); } finally { editor.dispose(); }
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.status === "completed");
    assert.match(JSON.stringify(fixture.requests[0]!.messages), /Generated client original/);
    assert.equal(JSON.stringify(fixture.requests[0]!.messages).includes("Generated changed source"), false);
    assert.equal(JSON.stringify(fixture.requests[0]!.messages).includes(path), false);
    await sdk.command({ type: "session.archive", sessionId: session.id });
    assert.equal((await sdk.attachments.read(session.id, attachment.id)).content.kind, "text");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("images are locally normalized, privately retained and blocked before unsupported-model admission without losing the draft", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const png = await generatedImage(), attached = await sdk.attachments.image(fixture.sessionId, png.toString("base64"), "Generated image");
    const image = fixture.session().draft.attachments[0]!;
    assert.equal(image.kind, "image");
    if (image.kind !== "image") throw new Error("Generated image descriptor missing.");
    assert.equal(image.width, 16); assert.equal(image.height, 12);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes(png.toString("base64")), false);
    const stored = await sdk.attachments.read(fixture.sessionId, attached.id!);
    assert.equal(stored.content.kind, "image");
    await assert.rejects(() => sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue" }), /image-capable/);
    assert.equal(fixture.session().draft.attachments.length, 1); assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk.attachments.image(fixture.sessionId, Buffer.from("Generated malformed image").toString("base64")), /valid single-frame/);
    await assert.rejects(() => sdk.attachments.image(fixture.sessionId, "invalid base64"), /canonical base64/);
    await assert.rejects(() => sdk.attachments.file(fixture.sessionId, join(fixture.directory, "state", "connection.json")), /state and connection credentials/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("an image-capable worker receives approved image bytes rather than silently dropping or converting them remotely", mac, async () => {
  const fixture = await setupFixture({ imageInput: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.attachments.image(fixture.sessionId, (await generatedImage()).toString("base64"));
    await fixture.send("Generated image context.");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.match(JSON.stringify(fixture.requests[0]!.messages), /data:image\/png;base64,/);
    assert.equal(fixture.session().messages.find((message) => message.role === "user")?.attachments?.[0]?.kind, "image");
    const controls = fixture.session().controls;
    fixture.provider.state.models[0]!.imageInput = false; fixture.provider.onChange();
    await fixture.send("Generated later text question.", "queue").then(() => assert.fail("Prior approved image context cannot be silently omitted."), (error: unknown) => assert.match(String(error), /image-capable/));
    assert.equal(fixture.session().controls.modelId, controls.modelId);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("generated image data above the text-only 1 MiB limit reaches the image-capable worker intact", mac, async () => {
  const fixture = await setupFixture({ imageInput: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const image = await sharp(randomBytes(768 * 768 * 3), { raw: { width: 768, height: 768, channels: 3 } }).png().toBuffer();
    await sdk.attachments.image(fixture.sessionId, image.toString("base64"));
    assert.ok(fixture.session().draft.attachments[0]!.bytes > 1024 * 1024);
    await fixture.send("Generated image exceeds the separate text-only bound.");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.match(JSON.stringify(fixture.requests[0]!.messages), /data:image\/png;base64,/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("folder preview lists its exact allowed file set and rejects source races, protected files and symlink escapes", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const folder = join(fixture.directory, "generated-folder"); await mkdir(folder);
    await writeFile(join(folder, ".gitignore"), "ignored.txt\n"); await writeFile(join(folder, "allowed.txt"), "Generated folder source.");
    await writeFile(join(folder, "ignored.txt"), "Generated excluded source."); await writeFile(join(folder, ".env"), "GENERATED_FAKE_SECRET=not-used");
    await symlink(join(fixture.project, "fixture.txt"), join(folder, "escape.txt"));
    const preview = (await sdk.attachments.folderPreview(fixture.sessionId, folder)).preview;
    assert.ok(preview.files.some((file) => file.path === "allowed.txt"));
    assert.ok(!preview.files.some((file) => ["ignored.txt", ".env", "escape.txt"].includes(file.path)));
    assert.ok(preview.excluded.length >= 3); assert.equal(fixture.requests.length, 0);
    await writeFile(join(folder, "allowed.txt"), "Generated concurrent change.");
    await assert.rejects(() => sdk.attachments.folder(fixture.sessionId, folder, preview.digest, true), /changed after preview/);
    assert.equal(fixture.session().draft.attachments.length, 0);
    const current = (await sdk.attachments.folderPreview(fixture.sessionId, folder)).preview;
    await sdk.attachments.folder(fixture.sessionId, folder, current.digest, true);
    assert.equal(fixture.session().draft.attachments[0]?.kind, "folder");
    const read = await sdk.attachments.read(fixture.sessionId, fixture.session().draft.attachments[0]!.id);
    assert.ok(read.content.kind === "text" && read.content.text.includes("Generated concurrent change."));
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("reviewed aggregate context binds the actual session/model destination, not only source bytes", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const preview = (await sdk.attachments.folderPreview(fixture.sessionId, fixture.project)).preview;
    assert.equal(preview.destination.env, "Local"); assert.equal(preview.destination.modelId, null);
    await fixture.configure();
    await assert.rejects(() => sdk.attachments.folder(fixture.sessionId, fixture.project, preview.digest, true), /destination changed after preview/);
    assert.equal(fixture.session().draft.attachments.length, 0);
    const current = (await sdk.attachments.folderPreview(fixture.sessionId, fixture.project)).preview;
    assert.equal(current.destination.modelId, fixture.modelId);
    await sdk.attachments.folder(fixture.sessionId, fixture.project, current.digest, true);
    assert.equal(fixture.session().draft.attachments[0]?.kind, "folder"); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("GitHub snapshots keep reference type/revision and retained session context survives source deletion", mac, async () => {
  let body = "Generated issue context.";
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (url) => Response.json({ number: 4, html_url: String(url).includes("/pulls/") ? "https://github.com/generated/example/pull/4" : "https://github.com/generated/example/issues/4", title: "Generated reference", body, state: "open", updated_at: "2026-01-01T00:00:00Z" }) } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const url = "https://github.com/generated/example/issues/4", preview = (await sdk.attachments.githubPreview(fixture.sessionId, url)).preview;
    assert.equal(preview.kind, "github_issue");
    body = "Generated changed remote context.";
    await assert.rejects(() => sdk.attachments.github(fixture.sessionId, url, "public", preview.digest, true), /changed after preview/);
    const prUrl = "https://github.com/generated/example/pull/4", pr = (await sdk.attachments.githubPreview(fixture.sessionId, prUrl)).preview;
    await sdk.attachments.github(fixture.sessionId, prUrl, "public", pr.digest, true);
    assert.equal(fixture.session().draft.attachments[0]?.kind, "github_pr");
    await fixture.configure(); await fixture.send("Generated source transcript."); await fixture.terminal();
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId });
    const destination = await sdk.sessions.create(null), session = (await sdk.attachments.sessionPreview(destination.id!, fixture.sessionId)).preview;
    await sdk.attachments.session(destination.id!, fixture.sessionId, session.digest, true);
    const id = sdk.getState().snapshot!.sessions.find((session) => session.id === destination.id)?.draft.attachments[0]!.id!;
    await sdk.sessions.delete(fixture.sessionId, true);
    const read = await sdk.attachments.read(destination.id!, id);
    assert.ok(read.content.kind === "text" && read.content.text.includes("Generated source transcript."));
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
