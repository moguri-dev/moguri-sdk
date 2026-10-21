import { cp, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { roleSequenceFixture } from "./role-sequence-api.ts";

const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) throw new Error("Choose an explicit new generated state directory for the external role consumer.");
const f = await roleSequenceFixture();
try {
  f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
  const sequence = f.current();
  await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
  const preview = (await f.sdk.artifacts.projectPreview(sequence.projectId!)).preview, configuration = (await f.sdk.projects.configuration(sequence.projectId!)).configuration;
  await f.sdk.projects.remove(sequence.projectId!, true, configuration.revision, { action: "retain", expectedDigest: preview.digest });
  await f.service.close(); await mkdir(destination, { mode: 0o700 });
  await cp(join(f.directory, "state"), destination, { recursive: true, force: false, errorOnExist: true });
  if (f.requests.length) throw new Error("Generated retained-role export must never dispatch inference.");
  console.log(JSON.stringify({ stateDir: destination, sequenceId: sequence.id, commandId: sequence.commandId, commandDigest: sequence.commandDigest,
    inputDigest: sequence.inputDigest, revision: sequence.revision, originSessionId: sequence.sessionId, rawMarker: "GENERATED_RETAINED_CRITIC_RESULT_NOT_CONTEXT" }));
} finally { await f.close(); }
