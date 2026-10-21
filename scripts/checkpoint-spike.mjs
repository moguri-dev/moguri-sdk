import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["--import", "tsx", "--test", "tests/reviewed-git.test.ts", "tests/winddown-budget.test.ts", "tests/winddown-primitives.test.ts", "tests/routing-primitives.test.ts", "tests/compound-routing-primitives.test.ts"], { stdio: "inherit" });
