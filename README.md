# moguri

A harness for your AI that works on your terms, both in a CLI (TUI) format and a desktop app, inspired by OpenCode
https://github.com/mbianchidev/open-moguri

Integrates with @mbianchidev/vslocal IDE with a VSX extension

## Extra features on top of OpenCode upstream

- Integration with local AI models ready to install
- New shortcuts with tags @ or slash commands /
- Structured and exposed harness plugins/instructions/skills
  - github plugin for correctly opening/closing/editing PRs, issues - querying CI checks, checking Actions logs, dependabot PRs, code review comment read + write + resolve convo
  - vulnerability resolution methods
  - conflict resolution with rebase vs merge on main/master or other target PRs
  - logging / observability
  - commit message style, rules (linted) and frequency
  - token savings `--silent` & co. + caveman
  - documentation guidelines (in docs/ not in random markdown files)
  - tech stack preferences
  - general coding guidelines
  - etc. see [https://github.com/mbianchidev/.github-private/blob/main/copilot-instructions.md](https://github.com/mbianchidev/.github-private/blob/main/copilot-instructions.md) for full list
- Better messaging
  - Automatically detects prompts that are repeated e.g. "Fix all review comments and rebase on main" will get a proposed slash command `/fix-rebase`
  - Allow ordering, deleting or modifying messages previously queued (if not picked up already)
- Native info dashboard
  - See pricing per session (depends on provider)
  - See token usage per session
  - Global aggregate dashboard with filters per: time (day, week, month, all time, custom), repo, github org, open source vs private, etc.
- New continous modes
  - Continous Product manager - implements PostHog in product -> gain insights on usage -> find metrics to improve and lack of features -> market research -> create issues -> create assumptions -> after implementation measures improvements and reports back to user
  - Continous Maintenance (toggle per repo)
  - Continous Docs (toggle per repo)
- New agent modes
  - Deep search - give a goal, run research, use sources and get to the bottom of a question (scientific oriented)
  - SRE - give an error, access to read-only infra MCPs, architecture diagrams and code -> get a resolution
  - Autopilot - give a clear task, agent works until the very end
  - Long running Autopilot - like the previous but for giant greenfield projects (e.g. a browser), complete rewrite of codebases (e.g. from C to Rust)
  - Stabilize - takes a repo, checks out the current status, tries to merge all the current pending PRs, fixes security issues, installs dependabot, enhances and hardens Actions, installs agentic workflows to triage issues
  - Swarm - Solves all open issues by creating a roadmap and rationalizing the end to end state of the repo, after planning carefully and reporting back to the user before implementation
  - Team (like squad)
- Integration with:
  - mbianchidev/sendbox - for sandboxing agents
  - mbianchidev/porto - for handling local dev servers and docker stacks
  - mbianchidev/sql not-so-lite - for local database management
  - mbianchidev/stainless - for dev previews
