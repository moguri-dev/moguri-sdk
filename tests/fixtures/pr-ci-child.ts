import { readFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { isRecord, MoguriError } from "../../packages/protocol/src/index.ts";
import { runProgram } from "../../apps/service/src/program.ts";
import type { createRuntime } from "../../packages/sdk/src/node.ts";

process.once("message", (input: unknown) => {
  void (async () => {
    if (!isRecord(input) || typeof input.packageRoot !== "string" || typeof input.directory !== "string") throw new Error("Generated CI child needs exact fixture directories.");
    const directory = input.directory, stateDir = join(directory, "state");
    const runtime: { createRuntime: typeof createRuntime } = await import(pathToFileURL(join(input.packageRoot, "dist", "sdk", "node.mjs")).href);
    const run: typeof runProgram = async (executable, args, options) => {
      if (executable !== "gh") return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
      const index = args.indexOf("--method"), method = args[index + 1], path = args[index + 2];
      if (!path || method !== "GET" && !(input.kind === "my-work" && method === "POST" && path === "graphql")) throw new Error("Generated CI child forbids GitHub writes and real authentication.");
      const fields: Record<string, string> = {};
      for (let index = 0; index < args.length - 1; index++) if (args[index] === "--raw-field" || args[index] === "--field") {
        const value = args[index + 1]!, split = value.indexOf("="); fields[value.slice(0, split)] = value.slice(split + 1);
      }
      if (method === "POST" && !fields.query?.startsWith("query(")) throw new Error("Generated inbox child permits only the fixed read query.");
      options.signal.throwIfAborted();
      await appendFile(join(directory, "requests.log"), `${path}\n`);
      const control: { head: string; state: "running" | "success"; blockInbox?: boolean } = JSON.parse(await readFile(join(directory, "control.json"), "utf8"));
      const repository = { id: 41, name: "fixture", full_name: "generated-owner/fixture", owner: { login: "generated-owner", type: "User" },
        html_url: "https://github.com/generated-owner/fixture", description: "Generated CI recovery repository", visibility: "private",
        private: true, default_branch: "main", license: { spdx_id: "MIT" }, ssh_url: "git@github.com:generated-owner/fixture.git",
        clone_url: "https://github.com/generated-owner/fixture.git" };
      let value: unknown;
      const pull = { id: 111, number: 11, title: "Generated recovery PR", updated_at: "2026-01-01T00:00:00Z",
        body: "Generated original CI source.", state: "open", draft: true, merged: false, html_url: "https://github.com/generated-owner/fixture/pull/11",
        head: { sha: control.head, ref: "generated-feature", repo: repository }, base: { sha: control.head, ref: "main", repo: repository } };
      if (path === "user") value = { login: "generated-owner", id: 42 };
      else if (path === "repos/generated-owner/fixture") value = repository;
      else if (path.startsWith("repos/generated-owner/fixture/pulls?") && input.kind === "my-work") value = [pull];
      else if (path === "repos/generated-owner/fixture/pulls/11") {
        if (input.kind === "my-work" && control.blockInbox) await new Promise<void>((_resolve, reject) =>
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
        value = pull;
      } else if (path === "graphql") {
        const requests = fields.query!.includes("reviewRequests(");
        value = { data: { repository: { nameWithOwner: repository.full_name, pullRequest: { number: 11,
          headRefOid: control.head, state: "OPEN", reviewDecision: "REVIEW_REQUIRED",
          [requests ? "reviewRequests" : "reviewThreads"]: { totalCount: 1, nodes: requests ?
            [{ id: "GENERATED_REQUEST", requestedReviewer: { __typename: "User", id: "GENERATED_USER", login: "generated-reviewer", url: "https://github.com/generated-reviewer" } }] :
            [{ id: "GENERATED_THREAD", isResolved: false, isOutdated: false, path: "fixture.txt", line: 1,
              comments: { nodes: [{ databaseId: 83, body: "Generated retained unresolved conversation.", url: "https://github.com/generated-owner/fixture/pull/11#discussion_r83" }] } }],
          pageInfo: { hasNextPage: false, endCursor: null } } } } } };
      }
      else if (path.includes("/check-runs?")) value = { total_count: 1, check_runs: [{ id: 82, name: "Generated retained check",
        head_sha: control.head, status: control.state === "running" ? "in_progress" : "completed", conclusion: control.state === "running" ? null : "success" }] };
      else if (path.includes("/status?")) value = { sha: control.head, total_count: 0, statuses: [] };
      else if (path.includes("/actions/runs?")) value = { total_count: 0, workflow_runs: [] };
      else throw new Error(`Unsupported generated CI endpoint: ${path}`);
      return `HTTP/2.0 200 OK\n\n${JSON.stringify(value)}`;
    };
    const credentials = new Map<string, string>();
    const vault = { read: async (id: string) => credentials.get(id) ?? null, write: async (id: string, value: string) => { credentials.set(id, value); }, remove: async (id: string) => { credentials.delete(id); } };
    const service = await runtime.createRuntime({ stateDir, retentionKey: Buffer.alloc(32, 0x63), provider: {
      state: { status: "disconnected", models: [], login: null, diagnostic: "Generated provider-free CI recovery" }, onChange: () => {},
      refresh: async () => {}, cancel: async () => {}, logout: async () => {},
      login: () => { throw new Error("No personal authorization in CI recovery."); },
      prepare: async () => { throw new Error("CI watching cannot start inference."); },
    }, platform: { vault, github: { runProgram: run }, integrations: { githubCliRead: async (endpoint, root, signal) => {
      const value = await run("gh", ["api", "--method", "GET", endpoint], { cwd: root, signal, label: "Generated CI account" });
      return JSON.parse(value.slice(value.indexOf("\n\n") + 2));
    } } } });
    process.on("message", (message) => { if (message === "close") void service.close().then(() => process.disconnect?.()); });
    process.send?.(service.connection);
  })().catch((error: unknown) => {
    process.send?.({ kind: "fixture.failed", diagnostic: error instanceof Error ? error.message : "Generated CI child startup failed." });
    console.error(error instanceof MoguriError ? error.code : error); process.exitCode = 1; process.disconnect?.();
  });
});
