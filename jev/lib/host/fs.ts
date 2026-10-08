/**
 * The levels' Fs port over the host's `$.fs`. Globs walk the tree with `$.fs.list`, skipping the
 * directories prune would drop anyway.
 */
import type { EngineInterface } from "claude-code";
import type { Fs } from "../core/fs.ts";
import { SKIP_DIRS } from "../levels/level09/prune.ts";

const GLOB_CHARS = /[*?[\]{}]/;

export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") out += "(?:";
    else if (c === "}") out += ")";
    else if (c === "," && out.lastIndexOf("(?:") > out.lastIndexOf(")")) out += "|";
    else if (c === "[") {
      const end = pattern.indexOf("]", i);
      out += end > i ? pattern.slice(i, end + 1) : "\\[";
      if (end > i) i = end;
    } else out += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

async function glob($: EngineInterface, pattern: string, cwd: string): Promise<string[]> {
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex((s) => GLOB_CHARS.test(s));
  const base = segments.slice(0, firstGlob).join("/");
  const deep = segments.slice(firstGlob).some((s) => s.includes("**"));
  const depth = segments.length - firstGlob;
  const match = globToRegExp(pattern);
  const out: string[] = [];
  const walk = async (dir: string, level: number) => {
    const full = dir.startsWith("/") ? dir : `${cwd}/${dir}`;
    const entries = await $.fs.list(full).catch(() => []);
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (match.test(path)) out.push(path);
      if (entry.kind === "dir" && !SKIP_DIRS.has(entry.name) && (deep || level + 1 < depth)) await walk(path, level + 1);
    }
  };
  await walk(base, 0);
  return out;
}

export function hostFs($: EngineInterface): Fs {
  return {
    async stat(path) {
      const info = await $.fs.stat(path);
      return { isFile: info.kind === "file", size: info.size };
    },
    readText: (path) => $.fs.read(path),
    glob: (pattern, cwd) => glob($, pattern, cwd),
  };
}
