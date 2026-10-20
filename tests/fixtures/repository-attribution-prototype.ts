import licenseList from "spdx-license-list";
import { isRecord, MoguriError } from "../../packages/protocol/src/index.ts";
import { fetchJson } from "../../apps/service/src/network.ts";

export interface RepositoryReadBinding { digest: string; repository: string | null }
function repositoryIdentity(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new MoguriError("repository_identity", "A canonical GitHub repository identity is required."); }
  const match = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/);
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match || [".", ".."].includes(match[2]!)) {
    throw new MoguriError("repository_identity", "Repository identity must be an exact credential-free GitHub URL. No alias or host was guessed.");
  }
  return { owner: match[1]!, name: match[2]!, fullName: `${match[1]}/${match[2]}` };
}
export function observedRepository(expected: string, value: unknown) {
  const identity = repositoryIdentity(expected);
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || typeof value.id !== "number" || value.id < 1 ||
    typeof value.name !== "string" || typeof value.full_name !== "string" || typeof value.html_url !== "string" ||
    !isRecord(value.owner) || typeof value.owner.login !== "string" || !["User", "Organization"].includes(String(value.owner.type)) ||
    typeof value.private !== "boolean") {
    throw new MoguriError("repository_response", "GitHub did not return a complete typed repository identity. No attribution was retained.");
  }
  const visibility = value.visibility;
  if (visibility !== "public" && visibility !== "private" && visibility !== "internal") throw new MoguriError("repository_response", "Repository visibility is not a recognized observed value.");
  const returned = repositoryIdentity(value.html_url);
  if (returned.fullName.toLowerCase() !== identity.fullName.toLowerCase() || value.full_name.toLowerCase() !== returned.fullName.toLowerCase() ||
    value.name !== returned.name || value.owner.login !== returned.owner || value.visibility === "public" && value.private ||
    value.visibility === "private" && !value.private) throw new MoguriError("repository_response", "Repository response identity or visibility disagrees with the exact selected repository.");
  let licenseId: string | null = null, osiApproved: boolean | null = null;
  if (value.license !== null) {
    if (!isRecord(value.license) || typeof value.license.spdx_id !== "string" || !/^[A-Za-z0-9.+-]{1,100}$/.test(value.license.spdx_id)) {
      throw new MoguriError("repository_license", "Repository license evidence is invalid. No open-source classification was invented.");
    }
    if (Object.hasOwn(licenseList, value.license.spdx_id)) {
      licenseId = value.license.spdx_id;
      const license = licenseList[licenseId];
      if (!license || typeof license.osiApproved !== "boolean") throw new MoguriError("repository_license", "The pinned license dataset has no valid OSI evidence.");
      osiApproved = license.osiApproved;
    }
  }
  return {
    id: value.id, url: value.html_url, fullName: value.full_name, owner: value.owner.login, ownerKind: value.owner.type === "Organization" ? "organization" as const : "user" as const,
    visibility, licenseId, osiApproved, publicOsiLicensed: visibility === "public" ? osiApproved : false,
    licenseData: "spdx-license-list@6.12.0" as const, observedAt: new Date().toISOString(),
  };
}
export async function lookupRepository(readBinding: () => Promise<RepositoryReadBinding>, fetcher: typeof fetch, signal: AbortSignal) {
  signal.throwIfAborted();
  const before = await readBinding();
  signal.throwIfAborted();
  if (!before.repository || !/^[a-f0-9]{64}$/.test(before.digest)) throw new MoguriError("repository_binding", "No exact supported repository binding is available. No network lookup was attempted.");
  const identity = repositoryIdentity(before.repository);
  const result = await fetchJson(fetcher, `https://api.github.com/repos/${identity.fullName}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  }, signal);
  signal.throwIfAborted();
  const repository = observedRepository(before.repository, result), after = await readBinding();
  signal.throwIfAborted();
  if (after.digest !== before.digest || after.repository !== before.repository) throw new MoguriError("repository_scope_changed", "Repository root/policy scope changed during lookup. No result was retained.", 409);
  return { bindingDigest: before.digest, repository };
}
