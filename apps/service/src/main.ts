import { stateDirectory } from "../../../packages/client/src/node.ts";
import { startService } from "./server.ts";

try {
  const service = await startService({ stateDir: stateDirectory() });
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
