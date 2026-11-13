import { isRecord, MoguriError } from "../../../packages/protocol/src/core.ts";

export function sandboxImageIdentity(value: unknown): { name: string; digest: string } {
  const invalid = (): never => { throw new MoguriError("sandbox_image_layout",
    "Apple Container image inspection has an unsupported, ambiguous or incomplete layout. No image identity, readiness or fallback was inferred.", 409); };
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return invalid();
  const image = value[0];
  let name: unknown, digest: unknown;
  if ("configuration" in image) {
    if ("name" in image || "index" in image || !isRecord(image.configuration) || !isRecord(image.configuration.descriptor)) return invalid();
    name = image.configuration.name; digest = image.configuration.descriptor.digest;
    if (typeof digest !== "string" || image.id !== digest.slice("sha256:".length)) return invalid();
  } else {
    if (!isRecord(image.index)) return invalid();
    name = image.name; digest = image.index.digest;
  }
  if (typeof name !== "string" || !name || name.length > 4096 || /[\s\0]/.test(name) ||
    typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) return invalid();
  return { name, digest };
}

export function sandboxContainerInventory(value: unknown): Array<{ id: string; configuration: Record<string, unknown>; status: string }> {
  const invalid = (): never => { throw new MoguriError("sandbox_inventory",
    "Apple Container inventory has an unsupported or ambiguous identity/status layout. Original guest presence and cleanup remain unconfirmed.", 409); };
  if (!Array.isArray(value)) return invalid();
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry.configuration)) return invalid();
    const configuration = entry.configuration, id = configuration.id;
    if (typeof id !== "string" || !id || id.length > 4096 || /[\0\r\n]/.test(id) || "id" in entry && entry.id !== id) return invalid();
    const status = typeof entry.status === "string" ? entry.status :
      isRecord(entry.status) && !("status" in entry.status) ? entry.status.state : undefined;
    if (typeof status !== "string" || !["created", "starting", "running", "stopping", "stopped", "unknown"].includes(status)) return invalid();
    return { id, configuration, status };
  });
}
