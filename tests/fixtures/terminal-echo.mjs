import { appendFileSync } from "node:fs";

appendFileSync(process.argv[2], "generated-start\n", { mode: 0o600 });
if (!process.stdin.isTTY) throw new Error("Generated terminal fixture requires a real PTY.");
process.stdin.setRawMode(true); process.stdin.setEncoding("utf8");
process.stdout.write("GENERATED_READY\r\n");
process.on("SIGWINCH", () => process.stdout.write(`GENERATED_SIZE=${process.stdout.columns}x${process.stdout.rows}\r\n`));
process.on("SIGTERM", () => process.exit(0));
let pending = "";
process.stdin.on("data", (text) => {
  pending += text;
  let end;
  while ((end = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, end).replace(/\r$/, ""); pending = pending.slice(end + 1);
    if (line === "GENERATED_BIG") process.stdout.write(`GENERATED_BIG_START${"\u03bb".repeat(100_000)}GENERATED_BIG_END\r\n`);
    else process.stdout.write(`GENERATED_ECHO=${line}\r\n`);
  }
});
