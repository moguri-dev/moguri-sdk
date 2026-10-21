import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const assets = {
  "darwin-arm64": ["macos-aarch64-metal", "5cb02ba7c04f0b5585ce5cde9c830be5f0b7dfb4c83083c500109c381b4f2da9", 5031510],
  "darwin-x64": ["macos-x86_64-cpu", "d52c318d8197511d4f7eee02bcf05511f7e91b300555a130b562e571695a0f39", 5256846],
  "linux-arm64": ["linux-aarch64-cpu", "ac50694d4729f9eae390a9851d38f51269d9af9829b535325539090a3b95c787", 6309769],
  "linux-x64": ["linux-x86_64-cpu", "f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507", 6683477],
};
export async function prepareSpeech(destination = resolve(".native/speech")) {
  const asset = assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error("No qualified native speech runtime for this platform.");
  const binary = join(destination, "bin", "nemo-speech");
  try {
    const metadata = JSON.parse(await readFile(join(destination, "moguri-runtime.json"), "utf8"));
    if (metadata.version === "0.2.0" && metadata.sha256 === asset[1]) { await access(binary); return binary; }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    if (error instanceof SyntaxError) throw new Error("Speech runtime metadata is corrupt. Remove only .native/speech and reinstall.");
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), "speech-download-"));
  try {
    const name = `nemo-speech-0.2.0-${asset[0]}.tar.gz`;
    const response = await fetch(`https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/${name}`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`NVIDIA runtime download failed (${response.status}).`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== asset[2] || createHash("sha256").update(data).digest("hex") !== asset[1]) throw new Error("NVIDIA runtime size or SHA-256 did not match the pinned release.");
    const archive = join(temporary, "runtime.tar.gz");
    await writeFile(archive, data);
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("Unsafe path in NVIDIA runtime archive.");
    const top = entries[0].split("/")[0];
    const stripped = entries.every((entry) => entry.startsWith(`${top}/`) || entry === top);
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    execFileSync("tar", ["-xzf", archive, "-C", unpacked, ...(stripped ? ["--strip-components=1"] : [])]);
    await access(join(unpacked, "bin", "nemo-speech"));
    await writeFile(join(unpacked, "moguri-runtime.json"), JSON.stringify({ version: "0.2.0", sha256: asset[1], license: "Apache-2.0" }));
    await access(destination).then(() => { throw new Error("A different speech runtime already exists. Inspect it before reinstalling."); }, (error) => { if (error.code !== "ENOENT") throw error; });
    await rename(unpacked, destination);
    return binary;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(await prepareSpeech());
