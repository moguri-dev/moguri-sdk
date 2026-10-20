import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureNativeSource, assertNativeSource, inspectNativeStage, materializeNativeStage } from "../apps/service/src/native-staging.ts";

const policy = { denied: [], readOnly: [] }, signal = () => new AbortController().signal;
async function stagingFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-stage-"))), source = join(directory, "source"), state = join(directory, "state");
  await mkdir(source, { mode: 0o700 }); await mkdir(state, { mode: 0o700 }); await mkdir(join(source, "src"));
  await writeFile(join(source, "src/generated.ts"), "export const generated = 'original';\n");
  await writeFile(join(source, "generated.sh"), "printf GENERATED_PRIVATE_STAGE\n", { mode: 0o700 });
  const owner = { profileId: "default", sessionId: randomUUID(), turnId: randomUUID() };
  return { directory, source, state, owner, capture: () => captureNativeSource(source, ["src/generated.ts", "generated.sh"], policy, signal()),
    close: () => rm(directory, { recursive: true, force: true }) };
}

test("native staging copies only an exact captured text set into a private owned root without touching its source", async () => {
  const fixture = await stagingFixture();
  try {
    await writeFile(join(fixture.source, "unselected.txt"), "Generated excluded user work.");
    const source = await fixture.capture(), stage = await materializeNativeStage(fixture.state, fixture.owner, source, signal());
    assert.equal((await lstat(stage.directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(stage.workspace)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(stage.workspace, "generated.sh"))).mode & 0o777, 0o700);
    assert.equal((await lstat(join(stage.workspace, "src/generated.ts"))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(stage.workspace, "src/generated.ts"), "utf8"), source.files.find((file) => file.path === "src/generated.ts")?.text);
    await assert.rejects(() => lstat(join(stage.workspace, "unselected.txt")), { code: "ENOENT" });
    const inspected = await inspectNativeStage(stage); assert.equal(inspected.workspace, stage.workspace);
    await writeFile(join(stage.workspace, "src/generated.ts"), "Generated private candidate.\n");
    assert.equal(await readFile(join(fixture.source, "src/generated.ts"), "utf8"), "export const generated = 'original';\n");
    assert.equal(await readFile(join(fixture.source, "unselected.txt"), "utf8"), "Generated excluded user work.");
  } finally { await fixture.close(); }
});

test("a concurrent source edit stays intact and invalidates its recorded base without discarding a candidate", async () => {
  const fixture = await stagingFixture();
  try {
    const source = await fixture.capture(), stage = await materializeNativeStage(fixture.state, fixture.owner, source, signal());
    await writeFile(join(stage.workspace, "src/generated.ts"), "Generated staged candidate.\n");
    await writeFile(join(fixture.source, "src/generated.ts"), "Generated concurrent user edit.\n");
    await assert.rejects(() => assertNativeSource(source, signal()), /reviewed source changed/i);
    assert.equal(await readFile(join(fixture.source, "src/generated.ts"), "utf8"), "Generated concurrent user edit.\n");
    assert.equal(await readFile(join(stage.workspace, "src/generated.ts"), "utf8"), "Generated staged candidate.\n");
  } finally { await fixture.close(); }
});

test("native staging rejects protected, denied, ambiguous, escaping, binary and oversized source files explicitly", async () => {
  const fixture = await stagingFixture();
  try {
    await writeFile(join(fixture.source, ".env"), "Generated fixture credential placeholder.");
    await writeFile(join(fixture.source, "binary.dat"), Buffer.from([0, 255]));
    await writeFile(join(fixture.source, "large.txt"), "g".repeat(128 * 1024 + 1));
    await writeFile(join(fixture.directory, "outside.txt"), "Generated outside file.");
    await symlink(join(fixture.directory, "outside.txt"), join(fixture.source, "alias.txt"));
    for (const paths of [[".env"], ["../outside.txt"], ["alias.txt"], ["binary.dat"], ["large.txt"], ["generated.sh", "generated.sh"]]) {
      await assert.rejects(() => captureNativeSource(fixture.source, paths, policy, signal()));
    }
    await assert.rejects(() => captureNativeSource(fixture.source, ["src/generated.ts"], { denied: ["src"], readOnly: [] }, signal()), /denied/);
    await assert.rejects(() => captureNativeSource(fixture.source, Array.from({ length: 201 }, () => "generated.sh"), policy, signal()), /200-file/);
    const paths = Array.from({ length: 17 }, (_, index) => `generated-limit-${index}.txt`);
    await Promise.all(paths.map((path) => writeFile(join(fixture.source, path), "g".repeat(128 * 1024))));
    await assert.rejects(() => captureNativeSource(fixture.source, paths, policy, signal()), /2-MiB/);
  } finally { await fixture.close(); }
});

test("empty explicit source scopes stay empty and forged captured bytes never materialize", async () => {
  const fixture = await stagingFixture();
  try {
    const empty = await captureNativeSource(fixture.source, [], policy, signal()), stage = await materializeNativeStage(fixture.state, fixture.owner, empty, signal());
    await assert.rejects(() => lstat(join(stage.workspace, "generated.sh")), { code: "ENOENT" });
    const source = await fixture.capture(), changed = { ...source, files: source.files.map((file, index) => index ? file : { ...file, text: "Generated forged content." }) };
    await assert.rejects(() => materializeNativeStage(fixture.state, { ...fixture.owner, turnId: randomUUID() }, changed, signal()), /changed or unsupported/);
  } finally { await fixture.close(); }
});

test("source and ownership arguments are immutable snapshots across asynchronous materialization", async () => {
  const fixture = await stagingFixture();
  try {
    const paths = ["src/generated.ts"], mutablePolicy = { denied: [] as string[], readOnly: [] as string[] };
    const pending = captureNativeSource(fixture.source, paths, mutablePolicy, signal());
    paths.push(".env"); mutablePolicy.denied.push("src");
    const source = await pending;
    assert.deepEqual(source.files.map((file) => file.path), ["src/generated.ts"]); assert.deepEqual(source.policy.denied, []);
    const mutable = { ...source, files: source.files.map((file) => ({ ...file })) }, owner = { ...fixture.owner };
    const materialization = materializeNativeStage(fixture.state, owner, mutable, signal());
    owner.turnId = randomUUID(); mutable.files[0]!.text = "Generated caller mutation.";
    const stage = await materialization;
    assert.equal(stage.turnId, fixture.owner.turnId); await inspectNativeStage(stage);
    assert.equal(await readFile(join(stage.workspace, "src/generated.ts"), "utf8"), "export const generated = 'original';\n");
  } finally { await fixture.close(); }
});

test("cancellation preserves partial private staging and never writes back to the source", async () => {
  const fixture = await stagingFixture();
  try {
    const source = await fixture.capture(), abort = new AbortController();
    await assert.rejects(() => materializeNativeStage(fixture.state, fixture.owner, source, abort.signal, () => abort.abort()), /partial/);
    assert.equal(await readFile(join(fixture.source, "src/generated.ts"), "utf8"), "export const generated = 'original';\n");
    await lstat(join(fixture.state, "native-stages", fixture.owner.profileId, fixture.owner.turnId, "owner.json"));
    const before = new AbortController(); before.abort();
    await assert.rejects(() => materializeNativeStage(fixture.state, { ...fixture.owner, turnId: randomUUID() }, source, before.signal), /abort/i);
  } finally { await fixture.close(); }
});

test("native stage inspection rejects replaced roots, forged ownership and automatic reuse", async () => {
  const fixture = await stagingFixture();
  try {
    const source = await fixture.capture(), stage = await materializeNativeStage(fixture.state, fixture.owner, source, signal());
    await assert.rejects(() => materializeNativeStage(fixture.state, fixture.owner, source, signal()), { code: "EEXIST" });
    await assert.rejects(() => inspectNativeStage({ ...stage, profileId: "generated-other-profile" }), /exact owned/);
    await writeFile(join(stage.directory, "owner.json"), '{"format":"generated-forgery"}');
    await assert.rejects(() => inspectNativeStage(stage), /ownership/);
    await rename(fixture.source, join(fixture.directory, "original-source")); await mkdir(fixture.source);
    await assert.rejects(() => assertNativeSource(source, signal()), /directory was replaced/);
    assert.equal(await readFile(join(fixture.directory, "original-source/src/generated.ts"), "utf8"), "export const generated = 'original';\n");
  } finally { await fixture.close(); }
});

test("native stage parents cannot overlap the source or follow an unvalidated parent alias", async () => {
  const fixture = await stagingFixture();
  try {
    const source = await fixture.capture(), nested = join(fixture.source, "generated-staging-parent");
    await mkdir(nested, { mode: 0o700 });
    await assert.rejects(() => materializeNativeStage(nested, fixture.owner, source, signal()), /separate from the source/);
    const target = join(fixture.directory, "generated-alias-target"); await mkdir(target, { mode: 0o700 });
    await symlink(target, join(fixture.state, "native-stages"));
    await assert.rejects(() => materializeNativeStage(fixture.state, fixture.owner, source, signal()), /canonical|ownership/);
    await assert.rejects(() => lstat(join(target, fixture.owner.profileId)), { code: "ENOENT" });
  } finally { await fixture.close(); }
});

test("private stage inspection refuses changed permissions or a replaced workspace without rebinding source ownership", async () => {
  const fixture = await stagingFixture();
  try {
    const source = await fixture.capture(), stage = await materializeNativeStage(fixture.state, fixture.owner, source, signal());
    await chmod(stage.directory, 0o777); await assert.rejects(() => inspectNativeStage(stage), /ownership/); await chmod(stage.directory, 0o700);
    const old = join(stage.directory, "generated-old-workspace");
    await rename(stage.workspace, old); await mkdir(stage.workspace, { mode: 0o700 });
    await assert.rejects(() => inspectNativeStage(stage), /workspace was replaced/);
    await assertNativeSource(source, signal());
  } finally { await fixture.close(); }
});
