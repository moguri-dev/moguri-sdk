import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["--import", "tsx", "--test", "tests/routing-primitives.test.ts", "tests/compound-routing-primitives.test.ts"], { stdio: "inherit" });
