# Changelog

All mods share one version, tagged `vX.Y.Z` on `main`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[0.2.0]: https://github.com/Akeuuh/claude-mods/releases/tag/v0.2.0
[0.1.0]: https://github.com/Akeuuh/claude-mods/releases/tag/v0.1.0
