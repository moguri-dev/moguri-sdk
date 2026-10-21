import { cp } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { PROTOCOL_VERSION } from "../../packages/protocol/src/index.ts";
import { writeLegacyState } from "./legacy-state.ts";
import { roleSequenceFixture } from "./role-sequence-api.ts";

const destination = process.argv[2];
const targetProtocol = process.argv[3] === undefined ? PROTOCOL_VERSION : Number(process.argv[3]);
if (!destination || !isAbsolute(destination)) throw new Error("Choose an explicit new generated state directory for the external role consumer.");
if (targetProtocol !== 32 && targetProtocol !== PROTOCOL_VERSION) throw new Error("Generated retained-role export supports only schema 32 or the current protocol.");
const f = await roleSequenceFixture();
try {
  f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
  const sequence = f.current();
  await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
  const preview = (await f.sdk.artifacts.projectPreview(sequence.projectId!)).preview, configuration = (await f.sdk.projects.configuration(sequence.projectId!)).configuration;
  await f.sdk.projects.remove(sequence.projectId!, true, configuration.revision, { action: "retain", expectedDigest: preview.digest });
  if (targetProtocol === 32 && PROTOCOL_VERSION > 32) await writeLegacyState(f.service, 32);
  else await f.service.close();
  await cp(join(f.directory, "state"), destination, { recursive: true, force: false, errorOnExist: true });
  if (f.requests.length) throw new Error("Generated retained-role export must never dispatch inference.");
  console.log(JSON.stringify({ stateDir: destination, sequenceId: sequence.id, commandId: sequence.commandId, commandDigest: sequence.commandDigest,
    inputDigest: sequence.inputDigest, revision: sequence.revision, originSessionId: sequence.sessionId, rawMarker: "GENERATED_RETAINED_CRITIC_RESULT_NOT_CONTEXT" }));
} finally { await f.close(); }
