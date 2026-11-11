export function toolFailure(error: unknown, path?: unknown) {
  const missing = error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "not_found"].includes(String(error.code));
  return {
    text: missing ? `Not Found: ${typeof path === "string" ? JSON.stringify(path) : "The requested file or directory"} does not exist in this workspace.` :
      error instanceof Error ? error.message : "Tool execution failed. No successful operation was confirmed.",
    isError: true as const,
    ...(missing ? { errorCode: "not_found" } : {}),
  };
}
