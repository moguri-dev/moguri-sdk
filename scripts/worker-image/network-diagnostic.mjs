import { Resolver } from "node:dns/promises";
import { createConnection } from "node:net";
import { channel } from "node:diagnostics_channel";
import { probeSocksDomain } from "./proxy-probe.ts";

const requests = [];
channel("undici:request:create").subscribe(({ request }) => { if (request.method === "CONNECT" && requests.length < 8) requests.push({ method: request.method, path: request.path }); });
const causes = (error) => {
  const result = [];
  for (let current = error; current && result.length < 5; current = current.cause) result.push({ name: String(current.name).slice(0, 64),
    code: typeof current.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(current.code) ? current.code : null,
    proxyStatus: /Proxy response \((\d{3})\)/.exec(current.message ?? "")?.[1] ?? null });
  return result;
};
const attempt = async () => {
  try { return { status: (await fetch("https://api.githubcopilot.com/models", { redirect: "error", signal: AbortSignal.timeout(8000) })).status }; }
  catch (error) { return { failed: true, causes: causes(error) }; }
};
const resolver = new Resolver({ timeout: 6000, tries: 1 });
const result = { diagnostic: "generated-native-dns-proxy", credentials: false, servers: resolver.getServers(),
  proxyEnvironment: { nodeFlag: process.env.NODE_USE_ENV_PROXY === "1", sameHttpsCase: !process.env.https_proxy || process.env.https_proxy === process.env.HTTPS_PROXY } };
try { result.firstSocks = await probeSocksDomain(process.env.ALL_PROXY, "api.githubcopilot.com", 443, AbortSignal.timeout(12_000)); }
catch (error) { result.firstSocks = { failed: true, causes: causes(error) }; }
result.firstFetch = await attempt();
for (const method of ["resolve4", "resolve6"]) {
  try { result[method] = await resolver[method]("api.githubcopilot.com"); }
  catch (error) { result[method] = { code: String(error.code ?? "unknown").slice(0, 64) }; }
}
resolver.cancel();
const proxy = new URL(process.env.HTTPS_PROXY);
result.proxy = await new Promise((resolve) => {
  const socket = createConnection({ host: proxy.hostname, port: Number(proxy.port) });
  let text = "", done = false;
  const finish = (value) => { if (!done) { done = true; socket.destroy(); resolve(value); } };
  socket.setTimeout(12_000, () => finish({ timeout: true }));
  socket.on("error", (error) => finish({ code: String(error.code ?? "unknown").slice(0, 64) }));
  socket.on("connect", () => socket.write("CONNECT api.githubcopilot.com:443 HTTP/1.1\r\nHost: api.githubcopilot.com:443\r\n\r\n"));
  socket.on("data", (part) => { text += part.toString(); if (text.includes("\r\n") || text.length > 1024) finish({ status: /^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1] ?? null }); });
});
result.sameVmFetch = await attempt(); result.connectRequests = requests;
console.log(JSON.stringify(result));
