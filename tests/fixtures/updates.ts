import { createHash } from "node:crypto";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bundleTreeSha512 } from "../../apps/service/src/bundle-tree.ts";
import type { UpdateManifest } from "../../packages/protocol/src/application-updates.ts";
import { generatedZip, type GeneratedZipEntry } from "./documents.ts";

export async function generatedApplication(directory: string, version = "0.31.0-alpha.1", arch: "arm64" | "x64" = "arm64") {
  const binary = Buffer.alloc(32); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  const files: GeneratedZipEntry[] = [
    { name: "Contents/Info.plist", text: '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.moguri.app</string><key>CFBundleExecutable</key><string>Moguri</string></dict></plist>' },
    { name: "Contents/MacOS/Moguri", bytes: binary, mode: 0o100755 },
    { name: "Contents/Resources/app/package.json", text: JSON.stringify({ name: "moguri", version, main: "dist/desktop/main.mjs" }) },
    { name: "Contents/Resources/app/dist/desktop/main.mjs", text: "export const generatedDesktop = true;\n" },
    { name: "Contents/Resources/app/dist/service.mjs", text: "export const generatedService = true;\n" },
    { name: "Contents/Resources/app/dist/update-installer.mjs", text: "export const generatedInstaller = true;\n" },
    { name: "Contents/Resources/app/node_modules/node/bin/node", bytes: binary, mode: 0o100755 },
    { name: "Contents/Frameworks/Generated.framework/Versions/A/Generated", text: "Generated framework bytes.", mode: 0o100755 },
    { name: "Contents/Frameworks/Generated.framework/Versions/Current", text: "A", mode: 0o120777 },
    { name: "Contents/Frameworks/Generated.framework/Generated", text: "Versions/Current/Generated", mode: 0o120777 },
  ];
  const root = join(directory, "Moguri.app"); await mkdir(root, { recursive: true, mode: 0o755 });
  for (const file of files) {
    const path = join(root, file.name); await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    if (file.mode === 0o120777) await symlink(file.text!, path);
    else { await writeFile(path, file.bytes ?? file.text!, { mode: file.mode === 0o100755 ? 0o755 : 0o644 }); if (file.mode === 0o100755) await chmod(path, 0o755); }
  }
  const archive = generatedZip(files.map((file) => ({ ...file, name: `Moguri.app/${file.name}` })));
  const manifest: UpdateManifest = { schemaVersion: 1, repository: "mbianchidev/moguri", version, arch, bundleId: "dev.moguri.app",
    archive: { name: `Moguri-${version}-macos-${arch}.zip`, bytes: archive.length, sha512: createHash("sha512").update(archive).digest("hex") }, bundleSha512: await bundleTreeSha512(root) };
  return { root, archive, manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)), files };
}
// A private generated repository answers anonymous API requests with 404, as GitHub does.
export function generatedUpdateFeed(generated: Awaited<ReturnType<typeof generatedApplication>>, visibility: "private" | "public" = "private") {
  const base = "https://api.github.com/repos/mbianchidev/moguri", requests: { url: string; authorization: string | null }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), authorization = new Headers(init?.headers).get("Authorization"); requests.push({ url, authorization });
    if (url.startsWith(base) && visibility === "private" && !authorization) return Response.json({ message: "Not Found" }, { status: 404 });
    if (url === base) return Response.json({ id: 42, full_name: "mbianchidev/moguri", private: visibility === "private" });
    if (url === `${base}/releases?per_page=10`) return Response.json([{ id: 101, tag_name: generated.manifest.version, draft: false, prerelease: true, published_at: new Date().toISOString(), assets: [
      { id: 201, name: `Moguri-${generated.manifest.version}-macos-${generated.manifest.arch}.manifest.json`, size: generated.manifestBytes.length },
      { id: 202, name: generated.manifest.archive.name, size: generated.archive.length },
    ] }]);
    if (url === `${base}/releases/assets/201`) return new Response(generated.manifestBytes);
    if (url === `${base}/releases/assets/202`) return new Response(null, { status: 302, headers: { Location: "https://release-assets.githubusercontent.com/generated/update.zip?generated=only" } });
    if (url.startsWith("https://release-assets.githubusercontent.com/")) return new Response(new Uint8Array(generated.archive));
    throw new Error("Unexpected generated update request. No real network is allowed.");
  };
  return { fetcher, requests, base };
}
