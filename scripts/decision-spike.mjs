import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["--import", "tsx", "--test", "tests/system-one-primitives.test.ts"], { stdio: "inherit" });
