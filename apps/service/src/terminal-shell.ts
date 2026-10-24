import { userInfo } from "node:os";
import { isAbsolute } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/core.ts";

export function terminalShell(environment: NodeJS.ProcessEnv = process.env, readAccountShell: () => string | null = () => userInfo().shell): string {
  let shell: string | null | undefined = environment.SHELL;
  if (shell === undefined) {
    try { shell = readAccountShell(); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ERR_SYSTEM_ERROR")) throw error;
      throw new MoguriError("terminal_shell", `The execution host's account lookup could not resolve a console login shell: ${error.message}. Configure an explicit absolute SHELL; no fallback shell was selected.`, 409);
    }
  }
  if (!shell || !isAbsolute(shell) || /[\u0000-\u001f\u007f]/.test(shell)) {
    throw new MoguriError("terminal_shell", "The execution host has no valid absolute login shell. Configure its account shell or SHELL; no plain-shell fallback was selected.", 409);
  }
  return shell;
}

export function terminalEnvironment(root: string, shell?: string, environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = { PATH: environment.PATH ?? "/usr/bin:/bin", HOME: environment.HOME ?? root, LANG: environment.LANG ?? "en_US.UTF-8" };
  for (const key of ["SHELL", "USER", "LOGNAME", "LC_ALL", "LC_CTYPE", "TMPDIR", "ZDOTDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "STARSHIP_CONFIG"]) {
    if (environment[key] !== undefined) result[key] = environment[key];
  }
  if (shell) Object.assign(result, { SHELL: shell, TERM: "xterm-256color", TERM_PROGRAM: "ghostty", COLORTERM: "truecolor" });
  return result;
}
