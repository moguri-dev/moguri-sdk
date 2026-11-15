import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const platform = `${process.platform}-${process.arch}`;
const nemoAssets = {
  "darwin-arm64": ["macos-aarch64-metal", "5cb02ba7c04f0b5585ce5cde9c830be5f0b7dfb4c83083c500109c381b4f2da9", 5031510],
  "darwin-x64": ["macos-x86_64-cpu", "d52c318d8197511d4f7eee02bcf05511f7e91b300555a130b562e571695a0f39", 5256846],
  "linux-arm64": ["linux-aarch64-cpu", "ac50694d4729f9eae390a9851d38f51269d9af9829b535325539090a3b95c787", 6309769],
  "linux-x64": ["linux-x86_64-cpu", "f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507", 6683477],
};
const transcribeAssets = {
  "darwin-arm64": ["macos-arm64-metal", "75ea3a705f3edec09942fdbb1b2b5509d7ecd75bda55158a47a3ab1e2d1105b3", 2451560],
  "darwin-x64": ["macos-x86_64-cpu", "ca414e5b28706a2f2ecea1479b3e1c5f47d0f11f43aba86e289ae5c10b1ca40c", 1597590],
  "linux-arm64": ["linux-aarch64-cpu-vulkan", "5e9cc7b244949fc686d1272e796e965411e80cc768533f1704c3c53e4c7d695e", 18137774],
  "linux-x64": ["linux-x86_64-cpu-vulkan", "4fe87db8919ea34e461db7987713b580f54e6f3ed610457c5d8fb8eac1a15046", 22562331],
};
export const TRANSCRIBE_VERSION = "0.4.2";
export const transcribeLibrary = (directory) => join(directory, process.platform === "darwin" ? "libtranscribe.dylib" : "libtranscribe.so");

async function preparePinnedArchive({ destination, label, version, license, asset, url, entry }) {
  if (!asset) throw new Error(`No qualified native ${label} runtime for this platform.`);
  const target = entry(destination);
  try {
    const metadata = JSON.parse(await readFile(join(destination, "moguri-runtime.json"), "utf8"));
    if (metadata.version === version && metadata.sha256 === asset[1]) { await access(target); return target; }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    if (error instanceof SyntaxError) throw new Error(`${label} runtime metadata is corrupt. Remove only ${destination} and reinstall.`);
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), "speech-download-"));
  try {
    const response = await fetch(url(asset[0]), { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${label} runtime download failed (${response.status}).`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== asset[2] || createHash("sha256").update(data).digest("hex") !== asset[1]) throw new Error(`${label} runtime size or SHA-256 did not match the pinned release.`);
    const archive = join(temporary, "runtime.tar.gz");
    await writeFile(archive, data);
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    if (entries.some((item) => item.startsWith("/") || item.split("/").includes(".."))) throw new Error(`Unsafe path in ${label} runtime archive.`);
    const top = entries[0].split("/")[0];
    const stripped = entries.every((item) => item.startsWith(`${top}/`) || item === top);
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    execFileSync("tar", ["-xzf", archive, "-C", unpacked, ...(stripped ? ["--strip-components=1"] : [])]);
    await access(entry(unpacked));
    await writeFile(join(unpacked, "moguri-runtime.json"), JSON.stringify({ version, sha256: asset[1], license }));
    await access(destination).then(() => { throw new Error(`A different ${label} runtime already exists. Inspect it before reinstalling.`); }, (error) => { if (error.code !== "ENOENT") throw error; });
    await rename(unpacked, destination);
    return target;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function prepareSpeech(destination = resolve(".native/speech")) {
  return preparePinnedArchive({ destination, label: "NVIDIA NeMo-Speech", version: "0.2.0", license: "Apache-2.0", asset: nemoAssets[platform],
    url: (name) => `https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/nemo-speech-0.2.0-${name}.tar.gz`,
    entry: (directory) => join(directory, "bin", "nemo-speech") });
}
export function prepareTranscribe(destination = resolve(".native/transcribe")) {
  return preparePinnedArchive({ destination, label: "transcribe.cpp", version: TRANSCRIBE_VERSION, license: "MIT", asset: transcribeAssets[platform],
    url: (name) => `https://github.com/handy-computer/transcribe.cpp/releases/download/v${TRANSCRIBE_VERSION}/transcribe-native-${TRANSCRIBE_VERSION}-${name}.tar.gz`,
    entry: transcribeLibrary });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(await prepareSpeech(), await prepareTranscribe());
