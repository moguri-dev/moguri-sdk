import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["--import", "tsx", "--test", "tests/budget-plans.test.ts", "tests/budget-plans-runtime.test.ts", "tests/budget-plans-state.test.ts", "tests/budget-plans-recovery.test.ts"], { stdio: "inherit" });
