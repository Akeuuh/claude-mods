---
name: release
description: Bump the version of every mod in this marketplace, update CHANGELOG.md, open the release PR, then tag and publish the GitHub release once it is merged. Use when the user asks to release, bump the version, or publish a new version of claude-mods.
argument-hint: "[patch|minor|major]"
---

# Release claude-mods

All mods share one version. It lives in each `*/*/.claude-plugin/plugin.json` and nowhere else: `marketplace.json` carries no version. A release is a `vX.Y.Z` tag on `main` plus a GitHub release whose notes are the matching CHANGELOG section.

The release runs in two phases, because `main` is squash-merged: a tag set on the PR branch would point at a commit `main` never contains.

Pick the phase:

```bash
git fetch origin --tags && git tag --sort=-v:refname | head -1 && jq -r .version jev/guard/.claude-plugin/plugin.json
```

```bash
git show origin/main:jev/guard/.claude-plugin/plugin.json | jq -r .version
```

- The version on `origin/main` is above the latest tag: the release PR is merged, go to phase 2.
- Otherwise: phase 1.

## Phase 1: release PR

1. **Bump.** Take the level from the argument. Without one, propose it from the commits since the last tag (`git log <last-tag>..origin/main --oneline`): a breaking change → major, any `feat` → minor, else patch. Confirm with the user before going on.
2. **Branch** from `origin/main`: `claude/release-vX.Y.Z`.
3. **Versions.** Set `version` in every `plugin.json`, keeping the formatting:

   ```bash
   for f in */*/.claude-plugin/plugin.json; do jq --arg v X.Y.Z '.version=$v' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done
   ```

4. **CHANGELOG.** Add a `## [X.Y.Z] - YYYY-MM-DD` section above the previous one, and its link `[X.Y.Z]: https://github.com/Akeuuh/claude-mods/releases/tag/vX.Y.Z` above the previous link. Group the commits since the last tag under Keep a Changelog headings: `feat` → Added, `fix` → Fixed, a behavior change → Changed, a removal → Removed. One line per user-visible change, prefixed with the mod name. Skip `test`, `docs`, `chore` and `refactor` commits unless a user sees the effect. Show the section to the user before committing.
5. **Check.** All three must pass:

   ```bash
   bun run build && git diff --exit-code -- '*/hooks/register.js'
   ```

   ```bash
   bun run test
   ```

   ```bash
   bun run validate
   ```

   A diff on `register.js` means a mod's bundle is stale: stop and tell the user, it belongs in its own commit before the release.
6. **Commit** `chore(release): vX.Y.Z`, push, open the PR titled `Release vX.Y.Z` with the CHANGELOG section as body. Then tell the user to merge it and run this skill again.

## Phase 2: tag and publish

1. Check that `origin/main` carries the version and the CHANGELOG section.
2. Tag and push:

   ```bash
   git tag vX.Y.Z origin/main && git push origin vX.Y.Z
   ```

3. Publish the release with only that version's section as notes:

   ```bash
   awk '/^## \[X.Y.Z\]/{f=1;next} /^## \[|^\[X.Y.Z\]:/{f=0} f' CHANGELOG.md > "$TMPDIR/notes.md"
   ```

   ```bash
   gh release create vX.Y.Z --repo Akeuuh/claude-mods --title vX.Y.Z --notes-file "$TMPDIR/notes.md" --verify-tag
   ```

4. Give the user the release URL.

Pushes go through SSH: if the sandbox denies `~/.ssh`, rerun the push outside it.
