import { DatabaseSync, constants } from "node:sqlite";
import { parse, MoguriError, isRecord } from "../../../packages/protocol/src/core.ts";
import { StateSeedSchema, StateQuerySchema, StateMutationSchema } from "../../../packages/protocol/src/tooling.ts";
import { singleStatement, sqlScalar } from "./data-operations.ts";

const parameters = (values: (string | number | boolean | null)[] = []) => values.map((value) => typeof value === "boolean" ? Number(value) : value);
export function queryStateData(input: unknown, seed: unknown) {
  const source = parse(StateSeedSchema, seed), db = new DatabaseSync(":memory:", { allowExtension: false });
  const mutation = isRecord(input) && "statements" in input;
  const args = mutation ? parse(StateMutationSchema, input) : parse(StateQuerySchema, input);
  let internal = true;
  try {
    db.exec("PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF; PRAGMA hard_heap_limit=67108864;");
    db.exec("CREATE TABLE todos(id INTEGER PRIMARY KEY,text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','in_progress','done'))); CREATE TABLE memories(id TEXT PRIMARY KEY NOT NULL DEFAULT(lower(hex(randomblob(16)))),title TEXT NOT NULL,text TEXT NOT NULL,tier TEXT NOT NULL DEFAULT 'Sky' CHECK(tier IN('Sky','Terra')))");
    const insertTodo = db.prepare("INSERT INTO todos VALUES(?,?,?)"), insertMemory = db.prepare("INSERT INTO memories VALUES(?,?,?,?)");
    for (const row of source.todos) insertTodo.run(row.id, row.text, row.status);
    for (const row of source.memories) insertMemory.run(row.id, row.title, row.text, row.tier);
    db.setAuthorizer((action, first, second) => {
      if (internal) return constants.SQLITE_OK;
      if ([constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_RECURSIVE].includes(action)) return constants.SQLITE_OK;
      if (action === constants.SQLITE_FUNCTION && !["load_extension", "readfile", "writefile"].includes(String(second ?? first).toLowerCase())) return constants.SQLITE_OK;
      if (mutation && [constants.SQLITE_INSERT, constants.SQLITE_UPDATE, constants.SQLITE_DELETE].includes(action) && ["todos", "memories"].includes(String(first))) return constants.SQLITE_OK;
      return constants.SQLITE_DENY;
    });
    if ("sql" in args) {
      internal = false;
      const rows: Record<string, unknown>[] = [], limit = args.limit ?? 100;
      for (const row of singleStatement(db, args.sql).iterate(...parameters(args.parameters))) {
        rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlScalar(value)])));
        if (rows.length > limit) break;
        if (Buffer.byteLength(JSON.stringify(rows)) > 256 * 1024) throw new MoguriError("state_limit", "State query exceeds 256 KiB. Select fewer rows/columns.");
      }
      return { rows: rows.slice(0, limit), complete: rows.length <= limit, limit };
    }
    db.exec("BEGIN");
    internal = false;
    for (const entry of args.statements) singleStatement(db, entry.sql).run(...parameters(entry.parameters));
    internal = true;
    const count = Number(db.prepare("SELECT count(*) AS count FROM memories").get()?.count);
    if (count > 200 || Number(db.prepare("SELECT count(*) AS count FROM todos").get()?.count) > 50) throw new MoguriError("state_limit", "State rows exceed 50 todo steps or 200 notes. No domain mutation was committed.");
    const result = parse(StateSeedSchema, { todos: db.prepare("SELECT id,text,status FROM todos ORDER BY id").all(),
      memories: db.prepare("SELECT id,title,text,tier FROM memories ORDER BY id").all() });
    return { after: result };
  } finally { db.close(); }
}
