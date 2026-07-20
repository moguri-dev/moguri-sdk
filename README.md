# moguri

A harness for your AI that works on your terms, both in a CLI (TUI) format and a desktop app, inspired by OpenCode
https://github.com/mbianchidev/open-moguri

Integrates with @mbianchidev/vslocal IDE with a VSX extension

## Extra features on top of OpenCode upstream

- Integration with local AI models ready to install
- New shortcuts with tags @ or slash commands /
- Structured and exposed harness instructions
  - X
  - Y
  - Z
- New agent modes
  - Deep search - give a goal, run research, use sources and get to the bottom of a question (scientific oriented)
  - SRE - give an error, access to read-only infra MCPs, architecture diagrams and code -> get a resolution
  - Autopilot - give a clear task, agent works until the very end
  - Long running Autopilot - like the previous but for giant greenfield projects (e.g. a browser), complete rewrite of codebases (e.g. from C to Rust)
  - Stabilize - takes a repo, checks out the current status, tries to merge all the current pending PRs, fixes security issues, installs dependabot, enhances and hardens Actions, installs agentic workflows to triage issues
  - Swarm - Solves all open issues by creating a roadmap and rationalizing the end to end state of the repo, after planning carefully and reporting back to the user before implementation
  - Maintenance
  - Product
  - Team (like squad)

