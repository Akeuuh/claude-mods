/**
 * Level 6 as a Claude Code mod: guardrail hooks. The agent never knows Jev is here.
 *
 *   tool.call Bash          gateBashCommand, deny irreversible or destructive commands unless the person runs them anyway
 *   tool.call Write, Edit   gateWriteCall, deny paths outside the repo (code) and credentials (Jev), except the allow list in ~/.config/claude-mods/jev.json
 *   tool.call Read, Bash    screenToolResult on the result, a banner in `context` when it carries instructions
 */
import { basename, dirname, join, resolve } from "node:path";
import type { EngineInterface, On, ToolCallResult } from "claude-code";
import { BLOCK_NOTICE, gateBashCommand } from "../../lib/levels/level06/bash-gate.ts";
import { screenToolResult } from "../../lib/levels/level06/result-screen.ts";
import { ALLOW_LIST_FILE, expandAllowPath, gateWriteCall, inAllowList, mentionsAllowList } from "../../lib/levels/level06/write-gate.ts";
import { decide, levelConfig, logFailure, verdict, type Tone } from "../../lib/host/jev.ts";

type Option = "A" | "B" | "C";

type Outcome = "ok" | "overridden" | "blocked";

const TONE: Record<Outcome, Tone> = { ok: "ok", overridden: "warn", blocked: "block" };

const RUN_ANYWAY = "Run anyway";

const label = (reason: string) => reason.split(":")[0];

async function gatesOn($: EngineInterface): Promise<Option[]> {
  return (await levelConfig<{ gates: Option[] }>($, { gates: ["A", "B", "C"] })).gates;
}

/**
 * The way past a block, for the person and never for the agent: the gate holds the command while
 * the engine's own dialog names it and what Jev found. Where there is no one to ask (a -p run) or
 * the dialog is dismissed, the ask rejects and the block stands.
 */
async function askToRun($: EngineInterface, command: string, reason: string): Promise<boolean> {
  try {
    const chosen = await $.ui.ask(`jev-guard stopped \`${command}\` · ${reason}. Run it anyway?`, { header: "jev-guard", options: [RUN_ANYWAY, "Block"] });
    return chosen === RUN_ANYWAY;
  } catch {
    return false;
  }
}

async function screen($: EngineInterface, tool: string, ran: ToolCallResult): Promise<ToolCallResult> {
  if (ran.deny !== undefined || !(await gatesOn($)).includes("C")) return ran;
  try {
    const source = `tool.result ${tool}`;
    const d = await screenToolResult(tool, ran.text ?? "", (s, q) => decide($, source, s, q));
    verdict($, source, d.flag ? `${tool} flagged · injection ${d.noul.toFixed(2)}` : `${tool} clean · ${d.noul.toFixed(2)}`, d.flag ? "warn" : "ok");
    return d.flag && d.banner ? { ...ran, context: [...(ran.context ?? []), d.banner] } : ran;
  } catch (err) {
    logFailure($, "jev-guard: result screen failed: ", err);
    return ran;
  }
}

async function realPlace($: EngineInterface, path: string): Promise<string> {
  let dir = path;
  let rest = "";
  for (;;) {
    const real = (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath;
    if (real !== undefined) return join(real, rest);
    if (dirname(dir) === dir) return path;
    rest = join(basename(dir), rest);
    dir = dirname(dir);
  }
}

/** allowPaths that is not a list of strings throws below, and the catch allows nothing. */
async function inConfiguredAllowList($: EngineInterface, target: string, cwd: string): Promise<boolean> {
  const home = await $.env.get("HOME");
  if (!home) return false;
  const file = `${home}/${ALLOW_LIST_FILE}`;
  try {
    if (!(await $.fs.exists(file))) return false;
    const entries = (JSON.parse(await $.fs.read(file)) as { guard?: { allowPaths?: string[] } }).guard?.allowPaths ?? [];
    const dirs = await Promise.all(entries.map((entry) => realPlace($, expandAllowPath(entry, cwd, home))));
    return inAllowList(target, dirs, await realPlace($, file));
  } catch (err) {
    logFailure($, `jev-guard: ${file} unusable, no path allowed: `, err);
    return false;
  }
}

async function gateWrite($: EngineInterface, tool: string, path: string, content: string): Promise<string | null> {
  if (!(await gatesOn($)).includes("B")) return null;
  try {
    const source = `tool.call ${tool}`;
    const cwd = await $.session.cwd();
    const target = await realPlace($, resolve(cwd, path));
    if (await inConfiguredAllowList($, target, cwd)) {
      verdict($, source, `${tool} ok · allow list`, "ok");
      return null;
    }
    const d = await gateWriteCall(target, content, await realPlace($, cwd), (s, q) => decide($, source, s, q));
    verdict($, source, `${tool} ${d.block ? "blocked" : "ok"} · ${label(d.reason)}`, d.block ? "block" : "ok");
    return d.block ? `jev-guard blocked this ${tool}: ${d.reason}. ${BLOCK_NOTICE}` : null;
  } catch (err) {
    logFailure($, "jev-guard: write gate failed: ", err);
    return null;
  }
}

export function register(on: On) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const gates = await gatesOn($);
    let ranAnyway = false;
    if (gates.includes("B") && mentionsAllowList(e.command)) {
      const reason = `it names the allow list file ~/${ALLOW_LIST_FILE}, which only the user edits`;
      ranAnyway = await askToRun($, e.command, reason);
      const outcome: Outcome = ranAnyway ? "overridden" : "blocked";
      verdict($, "tool.call Bash", `Bash ${outcome} · allow list file`, TONE[outcome]);
      if (!ranAnyway) return { deny: `jev-guard blocked this command: ${reason}. ${BLOCK_NOTICE}` };
    }
    if (!ranAnyway && gates.includes("A")) {
      try {
        const d = await gateBashCommand(e.command, await $.session.cwd(), (s, q) => decide($, "tool.call Bash", s, q));
        const outcome: Outcome = !d.block ? "ok" : (await askToRun($, e.command, d.reason)) ? "overridden" : "blocked";
        verdict($, "tool.call Bash", `Bash ${outcome} · ${label(d.reason)}`, TONE[outcome]);
        if (outcome === "blocked") return { deny: `jev-guard blocked this command: ${d.reason}. ${BLOCK_NOTICE}` };
      } catch (err) {
        logFailure($, "jev-guard: bash gate failed: ", err);
      }
    }
    return screen($, "Bash", await next(e));
  });

  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const deny = await gateWrite($, "Write", e.file_path, e.content);
    return deny ? { deny } : next(e);
  });

  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const deny = await gateWrite($, "Edit", e.file_path, e.new_string);
    return deny ? { deny } : next(e);
  });

  on("tool.call", { tool: "Read" }, async ($, e, next) => screen($, "Read", await next(e)));
}
