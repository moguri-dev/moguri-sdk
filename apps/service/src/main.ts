import { stateDirectory } from "../../../packages/client/src/node.ts";
import { startService } from "./server.ts";
import { stateLocationDirectory } from "../../../packages/client/src/state-location.ts";
import { runtimeBuildVersion } from "./updates.ts";
import { pinnedInstalledApplication } from "./bundle-tree.ts";

export { startService };
if (import.meta.main) {
  try {
    const version = runtimeBuildVersion();
    const service = await startService({ stateDir: stateDirectory(), storage: { locatorDirectory: stateLocationDirectory(), explicitOverride: Boolean(process.env.MOGURI_STATE_DIR && process.env.MOGURI_STATE_DIR_EXPLICIT !== "0") },
      updates: { version, installationRoot: await pinnedInstalledApplication(version) } });
    console.error(`Moguri service ready on loopback (protocol ${service.connection.protocolVersion}).`);
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      void service.close().then(() => { process.exitCode = 0; }, () => { console.error("Moguri shutdown failed; inspect state before restarting."); process.exitCode = 1; });
    };
    process.on("SIGTERM", close);
    process.on("SIGINT", close);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Moguri service startup failed.");
    process.exitCode = 1;
  }
}
