import "../../apps/service/src/worker.ts";
import fs from "node:fs";
import { dirname } from "node:path";
import { syncBuiltinESMExports } from "node:module";

const originalOpen = fs.promises.open, originalRename = fs.promises.rename;
let publishedDirectory: string | undefined;
fs.promises.rename = async (...args: Parameters<typeof originalRename>) => {
  await originalRename(...args);
  if (String(args[0]).includes(".moguri-write-")) publishedDirectory = dirname(String(args[1]));
};
fs.promises.open = async (...args: Parameters<typeof originalOpen>) => {
  if (publishedDirectory && String(args[0]) === publishedDirectory && args[1] === "r") throw Object.assign(new Error("Generated post-publication directory-sync failure."), { code: "EIO" });
  return originalOpen(...args);
};
syncBuiltinESMExports();
