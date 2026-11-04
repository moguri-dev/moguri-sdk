import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.send || !process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error("Provide an owned IPC process with an SDK root, generated state and Home directory.");
const configured = Promise.withResolvers(), closing = Promise.withResolvers();
process.on("message", (value) => {
  if (value?.type === "configure") configured.resolve(value);
  else if (value?.type === "close") closing.resolve();
  else throw new Error("Unknown generated cold-service control message.");
});
const configuration = await configured.promise, began = performance.now();
assert.equal(configuration.retentionKey, "67".repeat(32), "Only the public generated fixture key may be used.");
const { createRuntime } = await import(pathToFileURL(join(process.argv[2], "dist/sdk/node.mjs")).href);
const provider = {
  state: configuration.provider, onChange: () => {}, refresh: async () => {}, cancel: async () => {},
  login: async () => { throw new Error("Personal authorization is forbidden in a generated cold startup."); },
  logout: async () => { throw new Error("Personal authorization is forbidden in a generated cold startup."); },
  prepare: async () => { throw new Error("No model call is authorized by this generated cold-opening fixture."); },
};
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null,
  write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
let runtime;
try {
  runtime = await createRuntime({
    stateDir: process.argv[3], retentionKey: Buffer.from(configuration.retentionKey, "hex"), provider,
    platform: { vault,
      terminal: { defaultRoot: process.argv[4], vault, executable: process.execPath, args: ["-e", "process.stdin.resume()"] },
      sandbox: { distribution: join(process.argv[3], "generated-unconfigured-native"), setup: { automatic: false } },
    },
  });
  process.send({ type: "ready", pid: process.pid, protocolVersion: runtime.connection.protocolVersion, runtimeMs: performance.now() - began });
  await closing.promise;
} finally {
  await runtime?.close();
  process.disconnect();
}
