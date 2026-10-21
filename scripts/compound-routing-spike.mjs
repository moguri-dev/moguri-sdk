import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["--import", "tsx", "--test", "tests/routing-primitives.test.ts", "tests/compound-routing-primitives.test.ts", "tests/owned-role-worker.test.ts", "tests/owned-role-ledger.test.ts"], { stdio: "inherit" });
