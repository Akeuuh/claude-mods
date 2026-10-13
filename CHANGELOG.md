# Changelog

All mods share one version, tagged `vX.Y.Z` on `main`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-10-13

### Added

- `branch-notes`: per-branch notes kept in `~/.claude/branch-notes/<repo>/`, riding in the system prompt so they survive a compaction, with a `note_add` tool, a reload on a `git checkout` in `Bash`, and `/notes` to show, list, open a pane, add, edit or prune them. The pane heads each section with its own glyph and colour and draws its entries as markdown.
- `jev-guard`: a command the bash gate blocks is held instead of denied outright. Jev asks the person, naming the command and the reason: **Run anyway** runs it, **Block** keeps the deny; with no one to ask (a `-p` run) or the ask dismissed, the block stands. A command that names the allow list file is held the same way.

### Fixed

- `jev-route`: `/jev-route off` turns routing off for good — subagents with no model of their own keep the session's model after `off`, `/model` or a pin, and a `/model` typed before the first prompt or right after `auto` is seen.

## [0.2.0] - 2026-10-09

### Added

- `jev-route`: Jev picks the model and the effort for each prompt and for each subagent with no model of its own, with `/jev-route` to pin, bound or turn it off, and its tiers in `~/.config/claude-mods/jev.json`.

## [0.1.0] - 2026-10-09

### Added

- `jev-guard`: Jev gates `Bash`, `Write` and `Edit`, screens `Read` and `Bash` results for injected instructions, with an allow list for the write gate.
- `jev-compact`: Jev decides when to compact, on every turn and on demand, and picks where the live work starts.
- `ask-jev-file`: `ask_jev_file_bool`, `_choice` and `_score` on one file.
- `ask-jev-files`: `ask_jev_files` on many files in parallel, and `pick_first_file`.
- `ask-jev`: `ask_jev` on any situation, with a spend ledger.
- `jev-hud`: a band above the prompt showing Jev's calls, verdicts, latency and spend, with a pause button that sets `JEV_PAUSED`.

[0.3.0]: https://github.com/Akeuuh/claude-mods/releases/tag/v0.3.0
[0.2.0]: https://github.com/Akeuuh/claude-mods/releases/tag/v0.2.0
[0.1.0]: https://github.com/Akeuuh/claude-mods/releases/tag/v0.1.0
