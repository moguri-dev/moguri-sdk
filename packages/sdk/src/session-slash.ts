import { ClientError } from "../../client/src/index.ts";
import { BulkSessionInputSchema, ControlsSchema, IssueInputSchema, isRecord, kupoModes, parse, type CommandClient, type Session, type SettingsSection, type SlashResult } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import { sessionShortId } from "./session-ids.ts";

export { sessionSlashCommands } from "../../protocol/src/slash-commands.ts";
const json = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });

export async function sessionSlash(sdk: MoguriSdk, session: Session, command: { name: string; argument: string }, client: CommandClient): Promise<SlashResult | null> {
  const { name, argument } = command, snapshot = sdk.getState().snapshot!;
  const project = () => {
    if (!session.projectId) throw new ClientError("project_required", "Choose this session's actual project. No previous project or root was adopted.");
    return session.projectId;
  };
  const view = (): SlashResult => {
    if (client !== "tui" && ["cache", "linear", "mcp", "model-token", "remote-model-token"].includes(name)) {
      throw new ClientError("credential_view", "Use this client's dedicated credential settings or the native TUI masked dialog. No credential was requested through a composer.");
    }
    return { kind: "client-view", name, argument };
  };
  const ok = (message: string): SlashResult => ({ kind: "ok", message });
  switch (name) {
    case "session-id":
      if (argument) throw new ClientError("session_id_input", "Use /session-id without arguments.");
      return json({ sessionId: session.id, shortId: sessionShortId(session.id), mention: `:${sessionShortId(session.id)}`, authority: "Reviewed public attachment only; no filesystem, private transcript, execution or permission grant." });
    case "wait-session": {
      const [action, id, value, extra] = argument.split(/\s+/);
      if (action === "review" && id && !value) return json(await sdk.sessions.waitPreview(session.id, id));
      if (action === "set" && id && value && !extra) return json(await sdk.command({ type: "session.wait", sessionId: session.id, targetSessionId: id, expectedDigest: value, confirm: true }));
      if (action === "cancel" && id && value && /^\d+$/.test(value) && !extra) return json(await sdk.sessions.cancelWait(session.id, id, Number(value)));
      throw new ClientError("session_wait_input", "Use /wait-session review ID, set ID SHA256 after exact task review, or cancel WAIT_ID REVISION. While waiting, unheld /stop cancels the dependency and holds prompts; ordinary commands stay queued. Only actual success releases a dependency.");
    }
    case "message-session": {
      const separator = argument.indexOf(" ");
      if (separator < 1) throw new ClientError("session_message_input", "Use /message-session EXACT_ID TEXT. An ID alone never grants coordination.");
      return json(await sdk.coordination.message(session.id, argument.slice(0, separator), argument.slice(separator + 1)));
    }
    case "sessions-bulk": {
      if (argument.startsWith("review ")) return json(await sdk.sessions.bulkPreview(parse(BulkSessionInputSchema, JSON.parse(argument.slice(7)))));
      const applied = argument.match(/^apply ([a-f0-9]{64}) ([\s\S]+)$/);
      if (applied) return json(await sdk.command({ type: "sessions.bulk", expectedDigest: applied[1]!, input: parse(BulkSessionInputSchema, JSON.parse(applied[2]!)), confirm: true }));
      throw new ClientError("session_bulk_input", "Use /sessions-bulk review JSON, then apply SHA256 JSON with the exact reviewed input. The service rechecks the whole selected tree.");
    }
    case "commands":
      if (!argument) return client === "tui" ? view() : json(snapshot.commandExecutions.filter((entry) => entry.sessionId === session.id));
      if (/^read\s+\S+$/.test(argument)) {
        const result = await sdk.commands.read(argument.replace(/^read\s+/, ""));
        if (result.execution.sessionId !== session.id) throw new ClientError("command_scope", "Choose a command from this exact session's retained history.");
        return json(result);
      }
      throw new ClientError("command_read", "Use /commands or /commands read EXECUTION_ID. Inspection never replays input or approves a tool.");
    case "issues": case "trace": case "details": case "archive": case "reload-draft": case "keep-draft":
      if (argument) throw new ClientError("slash_arguments", `Use /${name} without arguments.`);
      return view();
    case "issue": {
      const [action, id, value] = argument.split(/\s+/), projectId = project();
      if (action === "new" && !id || action === "edit" && id && !value) return view();
      if (action === "create" && ["feature", "bug", "misc"].includes(id ?? "")) {
        const title = argument.split(/\s+/).slice(2).join(" "), { board } = await sdk.issues.board(projectId);
        return json(await sdk.issues.create(projectId, { title, body: "", kind: parse(IssueInputSchema.properties.kind, id), phaseId: board.columns[0]!.id, pullRequestUrl: null }));
      }
      const issue = snapshot.issues.find((issue) => issue.id === id && issue.projectId === projectId);
      if (!issue) throw new ClientError("issue_missing", "Choose an exact card from this project's board.");
      if (action === "move" && value) return json(await sdk.issues.move(issue.id, value, issue.revision));
      if ((action === "archive" || action === "restore") && !value) return json(await sdk.issues.archive(issue.id, action === "archive", issue.revision));
      throw new ClientError("issue_input", "Use /issue new, edit ID, create feature|bug|misc TITLE, move ID PHASE, archive ID or restore ID.");
    }
    case "board":
      project();
      if (argument === "edit") return view();
      if (argument === "refresh") return json(await sdk.issues.refresh(project()));
      if (argument) throw new ClientError("board_input", "Use /board, /board edit or /board refresh.");
      return json(await sdk.issues.board(project()));
    case "settings":
      if (!argument) return { kind: "panel", panel: "Settings" };
      if (argument === "edit") return view();
      if (argument.startsWith("reset ")) {
        const section = argument.slice(6);
        if (section !== "all" && !Object.hasOwn(snapshot.settings.values, section)) throw new ClientError("settings_section", "Choose all or an existing shared settings section.");
        await sdk.settings.reset(section as SettingsSection | "all", snapshot.settings.revision);
        return ok("Shared settings reset through the actual profile.");
      }
      throw new ClientError("settings_input", "Use /settings, /settings edit or /settings reset SECTION.");
    case "project-settings":
      project();
      if (argument === "edit") return view();
      if (argument) throw new ClientError("project_settings_input", "Use /project-settings or /project-settings edit.");
      return json(await sdk.projects.configuration(project()));
    case "project-sources": return json(await sdk.projects.sources(project()));
    case "porto": return json(await sdk.projects.porto(project()));
    case "prompt":
      if (argument === "view") return json(await sdk.prompt.preview(session.id));
      if (argument === "reset") { await sdk.prompt.reset(snapshot.settings.revision); return ok("Shared system prompt reset."); }
      if (!argument || argument === "edit") return view();
      throw new ClientError("prompt_input", "Use /prompt view, /prompt reset or /prompt edit.");
    case "config": {
      const [action, id, hash, consent, extra] = argument.split(/\s+/);
      if (!argument || action === "list" && !id) return json(snapshot.configurationProposals.filter((proposal) => (proposal.projectId === session.projectId || proposal.sessionId === session.id) && proposal.status === "pending"));
      if (action === "review" && id && !hash) return json(await sdk.configuration.review(id));
      if ((action === "apply" || action === "reject") && id && hash && !extra && (action === "apply" ? consent === "acknowledge-risk" : !consent)) {
        await sdk.configuration.decide(id, action === "apply", hash, action === "apply"); return ok("Exact reviewed configuration decision recorded.");
      }
      throw new ClientError("configuration_input", "Use /config list, review ID, apply ID SHA256 acknowledge-risk or reject ID SHA256.");
    }
    case "notifications": return json({ settings: snapshot.settings.values.notifications, active: snapshot.attention.filter((entry) => entry.active), note: "Read acknowledgement never answers or approves." });
    case "plugins":
      if (!argument.startsWith("import ")) throw new ClientError("plugin_input", "Use /plugins import ABSOLUTE_PATH. Imports remain disabled.");
      return json(await sdk.capabilities.importPlugin(project(), argument.slice(7)));
    case "capabilities": return json({ registry: snapshot.registry.filter((entry) => entry.projectId === session.projectId), proposals: snapshot.proposals.filter((entry) => entry.projectId === session.projectId) });
    case "proposal": {
      const [action, id, hash, extra] = argument.split(/\s+/);
      if (action === "view" && id && !hash) return json(await sdk.capabilities.proposal(id));
      if ((action === "approve" || action === "reject") && id && hash && !extra) return json(await sdk.capabilities.decide(id, action === "approve", hash));
      throw new ClientError("proposal_input", "Use /proposal view ID, then approve|reject ID SHA256 after exact source review.");
    }
    case "cache": if (argument.startsWith("token ")) return view(); return null;
    case "linear": if (argument === "token") return view(); return null;
    case "mcp": {
      const [action, id = "builtin", ...rest] = argument.split(/\s+/);
      if (action === "servers") return json(await sdk.mcp.servers(session.id));
      if (action === "tools") return json(await sdk.mcp.tools(id, rest.join(" "), 0, session.id));
      if (action === "auth") return json(await sdk.mcp.auth(id, session.id));
      if (action === "login") { const created = await sdk.mcp.oauthBegin(id, session.id); return json(await sdk.mcp.oauthStatus(created.id!)); }
      if (action === "cancel") return json(await sdk.mcp.oauthCancel(id));
      if (action === "clear-oauth") return json(await sdk.mcp.oauthClear(id, session.id));
      if (action === "token" && id !== "builtin" && !rest.length) return view();
      if (action === "call" && rest.length >= 3) {
        const [tool, hash, ...jsonText] = rest, args: unknown = JSON.parse(jsonText.join(" "));
        if (!isRecord(args)) throw new ClientError("mcp_arguments", "Exact MCP arguments must be a JSON object.");
        return json(await sdk.mcp.call(session.id, id, tool!, args, hash!));
      }
      throw new ClientError("mcp_input", "Use /mcp servers, tools SERVER QUERY, auth SERVER, login SERVER, token SERVER or call SERVER TOOL SHA256 JSON. Never put credentials in command text.");
    }
    case "scripts": return json(await sdk.mcp.tools("builtin", "", 0, session.id));
    case "result": return json(await sdk.mcp.readResult(argument));
    case "subagent": return json(await sdk.subagents.run(session.id, argument));
    case "dictate": {
      if (argument === "status") return json(await sdk.voice.status());
      if (argument === "enable accept-license" || argument === "download accept-license") return json(await sdk.voice.enable(true));
      if (argument === "disable") return json(await sdk.voice.disable(true));
      if (argument === "prepare") return json(await sdk.voice.prepare());
      if (argument === "record") return json(await sdk.voice.record(session.id));
      const job = snapshot.jobs.findLast((job) => job.sessionId === session.id && job.kind === "voice.record" && job.status === "running");
      if (argument === "stop" && job) return json(await sdk.voice.stop(job.id));
      if (argument.startsWith("file ")) return json(await sdk.voice.transcribe(session.id, argument.slice(5)));
      const transcript = snapshot.jobs.findLast((job) => job.sessionId === session.id && job.status === "completed" && job.resultDigest && job.kind.startsWith("voice."));
      if (argument === "insert" && transcript) return json(await sdk.voice.insert(session.id, transcript.id, session.draft.revision));
      throw new ClientError("dictation_input", "Use /dictate status, enable accept-license, disable, prepare, record, stop, file PATH or insert. Disable removes only the exact managed model; no external files or other profiles' work are deleted.");
    }
    case "local-models":
      if (argument === "refresh") { await sdk.models.refresh(); return json(sdk.getState().snapshot?.provider); }
      if (argument) throw new ClientError("model_discovery_input", "Use /local-models or /local-models refresh.");
      return json({ endpoints: snapshot.settings.values.localModels, connections: snapshot.provider.connections, guidance: "Configure exact URLs and model limits in settings. Discovery never scans or infers." });
    case "model-token": case "remote-model-token":
      if (!argument || /\s/.test(argument)) throw new ClientError("model_token_input", `Use /${name} ENDPOINT_ID. Never put credentials in the composer.`);
      return view();
    case "defaults": return json({ global: snapshot.settings.values.startup.global, profile: snapshot.settings.values.startup.profile,
      project: session.projectId ? snapshot.projectConfigurations.find((configuration) => configuration.projectId === session.projectId)?.values.defaults ?? {} : {},
      current: session.controls, sources: session.defaults });
    case "steer": case "interrupt":
      if (!argument.trim()) throw new ClientError("followup_input", `Use /${name} TEXT. No empty or replacement prompt was sent.`);
      await sdk.command({ type: "slash.prompt.enqueue", sessionId: session.id });
      return ok("The exact original follow-up joined this session's queue ahead of later input. No earlier turn was interrupted or steered eagerly.");
    case "env": await sdk.sessions.env(session.id, parse(ControlsSchema.properties.env, argument)); return ok(`Session Env set to ${argument}. No fallback was used.`);
    case "autonomy": await sdk.sessions.autonomy(session.id, parse(ControlsSchema.properties.autonomy, argument)); return ok(`Session autonomy set to ${argument}. Hard policy is unchanged.`);
    case "kupo-mode": {
      const mode = kupoModes.find((entry) => entry.id === argument.trim().toLowerCase());
      if (!mode) throw new ClientError("kupo_mode_input", "Use /kupo-mode balanced|savings|performance. No routing preference was changed.");
      await sdk.sessions.kupoMode(session.id, mode.id);
      return ok(`Kupo routing preference set to ${mode.name}. Effort, budgets and permissions are unchanged.`);
    }
    case "attach": return json(await sdk.command({ type: "attachment.add", sessionId: session.id, path: argument, expectedRevision: session.draft.revision }));
    case "detach": {
      const attachments = session.draft.attachments.filter((entry) => entry.path !== argument && entry.id !== argument);
      if (attachments.length === session.draft.attachments.length) throw new ClientError("attachment_missing", "Choose an exact current attachment path or ID.");
      return json(await sdk.command({ type: "draft.save", sessionId: session.id, text: session.draft.text, attachments, expectedRevision: session.draft.revision }));
    }
    case "restore": return json(await sdk.command({ type: "session.restore", sessionId: session.id }));
    case "remove": return json(await sdk.command({ type: "queue.remove", sessionId: session.id, messageId: argument, expectedRevision: session.queueRevision }));
    case "queue-turn": return json(await sdk.command({ type: "queue.make-turn", sessionId: session.id, messageId: argument, expectedRevision: session.queueRevision }));
    case "edit": {
      const separator = argument.indexOf(" ");
      if (separator < 0) throw new ClientError("queue_edit", "Use /edit ITEM_ID replacement text.");
      return json(await sdk.command({ type: "queue.edit", sessionId: session.id, messageId: argument.slice(0, separator), text: argument.slice(separator + 1), expectedRevision: session.queueRevision }));
    }
    case "reorder": return json(await sdk.command({ type: "queue.reorder", sessionId: session.id, messageIds: argument.split(/\s+/), expectedRevision: session.queueRevision }));
    case "policy":
      if (argument !== "all" && argument !== "protected") throw new ClientError("env_policy", "Use /policy all or /policy protected. Existing turns are not rewritten.");
      await sdk.command({ type: "policy.set", allowedEnvs: argument === "all" ? ["Local", "Sandbox", "Remote"] : ["Sandbox", "Remote"] });
      return ok("Global new-turn Env policy saved. Existing running turns retain their captured boundary.");
    default: return null;
  }
}
