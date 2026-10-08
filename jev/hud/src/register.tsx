/**
 * A band above the prompt that shows Jev at work. The other jev mods log one JSON event per call
 * and per verdict on the debug log (lib/host/jev.ts); this mod reads them off `ui.log`, keeps the
 * last interventions in its state, and moves their readable transcript lines to the debug log.
 */
import { atom, read, update } from "claude-code";
import type { EngineInterface, On, Timer } from "claude-code";
import { EVENT_PREFIX, type JevEvent } from "../../lib/host/jev.ts";
import type { JevHudChip, JevHudStats, JevHudTone } from "../types";

const chips = atom({ plugin: "jev-hud", key: "chips" } as const, [] as JevHudChip[]);
const stats = atom({ plugin: "jev-hud", key: "stats" } as const, { calls: 0, inFlight: 0, ms: 0, usd: 0, blocks: 0 } as JevHudStats);
const frame = atom({ plugin: "jev-hud", key: "frame" } as const, 0);

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const MAX_CHIPS = 12;
const MAX_TEXT = 48;
const ICON: Record<JevHudTone, string> = { block: "⛔", warn: "⚠", ok: "✓", info: "◆", error: "✗" };
const COLOR: Record<JevHudTone, string> = { block: "error", warn: "warning", ok: "success", info: "claude", error: "error" };

const short = (source: string) => source.replace(/^tool\.(call|result) /, "");
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s);

function lastIndexOf(list: JevHudChip[], source: string, pendingOnly: boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].source === source && (!pendingOnly || list[i].isPending)) return i;
  return -1;
}

function replaceAt(list: JevHudChip[], i: number, chip: JevHudChip): JevHudChip[] {
  return i < 0 ? [...list, chip].slice(-MAX_CHIPS) : list.map((c, j) => (j === i ? chip : c));
}

export function applyEvent(list: JevHudChip[], event: JevEvent): JevHudChip[] {
  switch (event.kind) {
    case "start":
      return [...list, { source: event.source, text: short(event.source), tone: "info" as const, isPending: true }].slice(-MAX_CHIPS);
    case "done":
      return replaceAt(list, lastIndexOf(list, event.source, true), {
        source: event.source,
        text: `${short(event.source)} · ${event.brief}`,
        tone: event.isError ? "error" : "info",
        isPending: false,
      });
    case "verdict":
      return replaceAt(list, lastIndexOf(list, event.source, false), { source: event.source, text: event.text, tone: event.tone, isPending: false });
  }
}

export function applyStats(s: JevHudStats, event: JevEvent): JevHudStats {
  if (event.kind === "start") return { ...s, inFlight: s.inFlight + 1 };
  if (event.kind === "done") return { ...s, inFlight: Math.max(0, s.inFlight - 1), calls: s.calls + 1, ms: s.ms + event.ms, usd: s.usd + event.usd };
  return event.tone === "block" ? { ...s, blocks: s.blocks + 1 } : s;
}

function parse(text: string): JevEvent | null {
  try {
    const event = JSON.parse(text.slice(EVENT_PREFIX.length));
    return event && typeof event.kind === "string" && typeof event.source === "string" ? event : null;
  } catch {
    return null;
  }
}

/** Chips from the newest back, as many as the band's width holds, oldest first. */
function fit(list: JevHudChip[], columns: number): JevHudChip[] {
  const out: JevHudChip[] = [];
  let used = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const width = clip(list[i].text).length + 4;
    if (out.length && used + width > columns) break;
    out.unshift(list[i]);
    used += width;
  }
  return out;
}

let ticker: Timer | undefined;

async function record($: EngineInterface, event: JevEvent) {
  await update($, chips, (list) => applyEvent(list, event));
  const now = await update($, stats, (s) => applyStats(s, event));
  if (now.inFlight > 0 && !ticker) ticker = $.clock.every(100, () => update($, frame, (f) => f + 1));
  if (now.inFlight === 0 && ticker) {
    ticker.cancel();
    ticker = undefined;
  }
}

export function register(on: On) {
  on("ui.log", async ($, e, next) => {
    if (e.text.startsWith("jev · ")) return next({ ...e, to: "debug" });
    if (e.text.startsWith(EVENT_PREFIX)) {
      const event = parse(e.text);
      if (event) await record($, event);
    }
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const list = await read($, chips);
    if (e.props.hasSurvey || list.length === 0) return next(e);
    const s = await read($, stats);
    const spin = SPINNER[(await read($, frame)) % SPINNER.length];
    const shown = fit(list, e.props.bodyColumns ?? 80);
    const { Box, Text } = $.ui.resolve(e);
    const avg = s.calls ? Math.round(s.ms / s.calls) : 0;
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box>
          <Text color="claude" bold>{s.inFlight ? spin : "◆"} jev</Text>
          <Text dimColor>
            {"  "}{s.calls} calls · {avg} ms avg · ${s.usd.toFixed(5)}{s.blocks ? ` · ${s.blocks} blocked` : ""}
          </Text>
        </Box>
        <Box>
          {shown.map((c, i) => (
            <Text key={`${i}`} color={COLOR[c.tone]} bold={i === shown.length - 1} wrap="truncate">
              {c.isPending ? spin : ICON[c.tone]} {clip(c.text)}{i < shown.length - 1 ? "   " : ""}
            </Text>
          ))}
        </Box>
      </Box>
    );
  });
}
