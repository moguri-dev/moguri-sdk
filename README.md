# moguri

A harness for your AI that works on your terms, both in a CLI (TUI) format and a desktop app, inspired by OpenCode
https://github.com/mbianchidev/open-moguri

Integrates with @mbianchidev/vslocal IDE with a VSX extension

## Extra features on top of OpenCode upstream

- Integration with local AI models ready to install
- New productivity shortcuts
  - option/ctrl space for voice dictation with NVidia nemtron new model
- Profiles with (possibly) different API keys and projects binded to them, and different accents + policies
  - Work
  - Open Source
- Projects with worktrees
  - Work-tree aware sessions or from issue, or from PR (requires GitHub MCP, or Linear or Jira installed)
- Command palette
- Split panel
- Sidebar
- Metachat
  - Chat with moguri for changing its own settings and for trouble shooting
- Scheduled actions
  - Watch CI
  - Run prompt
  - Run agentic workflow (prompt + specific scripts with nice syntax) - optional delegated to server
- Granularity of views compact vs detailed for agent tools, steers, etc.
  - Expose ALL thinking (collapsible)
  - Share time elapsed since script started
  - Share total time elapsed since sub-session/sub-agent started (and token count if possible)
  - Share total time elapsed since whole session started
- Structured and exposed harness plugins/instructions/skills (with slash commands / when feasible - skills always)
  - github plugin for correctly opening/closing/editing PRs, issues - querying CI checks, checking Actions logs, dependabot PRs, code review comment read + write + resolve convo
  - vulnerability resolution methods
  - conflict resolution with rebase vs merge on main/master or other target PRs
  - logging / observability
  - commit message style, rules (linted) and frequency
  - commit message signing with secure SSH key and strip co-authored with to avoid doing free marketing for agents
  - token savings `--silent` & co. + caveman
  - documentation guidelines (in docs/ not in random markdown files)
  - tech stack preferences
  - general coding guidelines
  - etc. see [https://github.com/mbianchidev/.github-private/blob/main/copilot-instructions.md](https://github.com/mbianchidev/.github-private/blob/main/copilot-instructions.md) for full list
- Better messaging
  - Automatically detects prompts that are repeated e.g. "Fix all review comments and rebase on main" will get a proposed slash command `/fix-rebase`
  - Allow ordering, deleting or modifying messages previously queued (if not picked up already)
  - Allow sending immediately a queue message to steer the session
- Better chat/sessions
  - Unarchive sessions (not the deleted ones, of course)
- Native info dashboard
  - See pricing per session (depends on provider)
  - See token usage per session
  - Global aggregate dashboard with filters per: time (day, week, month, all time, custom), repo, github org, open source vs private, etc.
- New continous modes (taggable @ agents)
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
  - mbianchidev/sendbox - for sandboxing agents (settings profile)
  - mbianchidev/porto - for handling local dev servers and docker stacks (via CLI pre-installed)
  - mbianchidev/sql not-so-lite - for local database management (via CLI pre-installed)
  - mbianchidev/stainless - for dev previews (via MCP and open with)
