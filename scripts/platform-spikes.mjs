import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import * as vec from "sqlite-vec";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const report = [];
const db = new DatabaseSync(":memory:", { allowExtension: true });
try {
  vec.load(db);
  db.exec("CREATE VIRTUAL TABLE vectors USING vec0(project_id TEXT PARTITION KEY, embedding FLOAT[8] DISTANCE_METRIC=cosine); CREATE TABLE edges(source TEXT,target TEXT,kind TEXT)");
  const vector = (values) => Buffer.from(new Float32Array(values).buffer);
  const started = performance.now();
  for (let i = 0; i < 500; i++) db.prepare("INSERT INTO vectors(project_id,embedding) VALUES (?,?)").run(i % 2 ? "a" : "b", vector([1, i / 500, 0, 0, 0, 0, 0, 0]));
  const hits = db.prepare("SELECT rowid,distance FROM vectors WHERE embedding MATCH ? AND k=3 AND project_id=? ORDER BY distance").all(vector([1, 0, 0, 0, 0, 0, 0, 0]), "a");
  assert.equal(hits.length, 3);
  assert.ok(hits.every((row) => Number(row.rowid) % 2 === 0));
  db.prepare("INSERT INTO edges VALUES (?,?,?)").run("generated.ts", "helper.ts", "imports");
  assert.equal(db.prepare("SELECT target FROM edges WHERE source=?").get("generated.ts").target, "helper.ts");
  report.push({ spike: "SQLite vector partitions and graph", status: "PASS", rows: 500, elapsedMs: performance.now() - started });
} finally { db.close(); }
const server = new Server({ name: "generated-spike", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", description: "Generated fixture", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: "text", text: String(request.params.arguments.text) }] }));
const client = new Client({ name: "moguri-spike", version: "1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.equal((await client.listTools()).tools[0].name, "echo");
  const result = await client.callTool({ name: "echo", arguments: { text: "generated value" } });
  assert.equal(result.content[0].text, "generated value");
  report.push({ spike: "Official MCP discovery/call/result", status: "PASS" });
} finally { await client.close(); await server.close(); }
console.log(JSON.stringify(report, null, 2));
