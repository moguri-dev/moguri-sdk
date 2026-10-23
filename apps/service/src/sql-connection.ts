import { isRecord, MoguriError, sqlEndpoint, type SqlConnection, type UserSettings } from "../../../packages/protocol/src/index.ts";
import { fetchJson } from "./network.ts";

export async function sqlConnection(settings: UserSettings, fetcher: typeof fetch = fetch, signal = AbortSignal.timeout(5000)): Promise<SqlConnection> {
  const configured = settings.integrations?.sql ?? { enabled: false, endpoint: "http://127.0.0.1:9147" };
  const endpoint = sqlEndpoint(configured.endpoint).origin;
  if (!configured.enabled) return { enabled: false, endpoint, healthy: false, version: null, diagnostic: "Off. No daemon was started or contacted." };
  const result = await fetchJson(fetcher, `${endpoint}/api/health`, { method: "GET" }, signal);
  if (!isRecord(result) || result.status !== "ok" || typeof result.version !== "string" || !result.version || result.version.length > 128 || /[\u0000-\u001f\u007f]/.test(result.version)) {
    throw new MoguriError("sql_health", "The configured endpoint did not return sql-not-so-lite's bounded health/version response. No database was scanned or exposed.", 502);
  }
  return { enabled: true, endpoint, healthy: true, version: result.version,
    diagnostic: "The existing daemon reports healthy. Moguri made only a health request: no scan, database path, query, import or private-state grant." };
}
