// jev/hud/src/register.tsx
import { atom, read, update } from "claude-code";

// jev/lib/core/wire.ts
var RETRY_STATUSES = new Set([429, 502, 503, 529]);

// jev/lib/host/jev.ts
var EVENT_PREFIX = "jev-event ";

// jev/hud/src/register.tsx
var chips = atom({ plugin: "jev-hud", key: "chips" }, []);
var stats = atom({ plugin: "jev-hud", key: "stats" }, { calls: 0, inFlight: 0, ms: 0, usd: 0, blocks: 0 });
var frame = atom({ plugin: "jev-hud", key: "frame" }, 0);
var isPaused = atom({ plugin: "jev-hud", key: "isPaused" }, false);
var SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
var MAX_CHIPS = 12;
var MAX_TEXT = 48;
var ICON = { block: "⛔", warn: "⚠", ok: "✓", info: "◆", error: "✗" };
var COLOR = { block: "error", warn: "warning", ok: "success", info: "claude", error: "error" };
var short = (source) => source.replace(/^tool\.(call|result) /, "");
var clip = (s) => s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s;
function lastIndexOf(list, source, pendingOnly) {
  for (let i = list.length - 1;i >= 0; i--)
    if (list[i].source === source && (!pendingOnly || list[i].isPending))
      return i;
  return -1;
}
function replaceAt(list, i, chip) {
  return i < 0 ? [...list, chip].slice(-MAX_CHIPS) : list.map((c, j) => j === i ? chip : c);
}
function applyEvent(list, event) {
  switch (event.kind) {
    case "start":
      return [...list, { source: event.source, text: short(event.source), tone: "info", isPending: true }].slice(-MAX_CHIPS);
    case "done":
      return replaceAt(list, lastIndexOf(list, event.source, true), {
        source: event.source,
        text: `${short(event.source)} · ${event.brief}`,
        tone: event.isError ? "error" : "info",
        isPending: false
      });
    case "verdict":
      return replaceAt(list, lastIndexOf(list, event.source, false), { source: event.source, text: event.text, tone: event.tone, isPending: false });
  }
}
function applyStats(s, event) {
  if (event.kind === "start")
    return { ...s, inFlight: s.inFlight + 1 };
  if (event.kind === "done")
    return { ...s, inFlight: Math.max(0, s.inFlight - 1), calls: s.calls + 1, ms: s.ms + event.ms, usd: s.usd + event.usd };
  return event.tone === "block" ? { ...s, blocks: s.blocks + 1 } : s;
}
function parse(text) {
  try {
    const event = JSON.parse(text.slice(EVENT_PREFIX.length));
    return event && typeof event.kind === "string" && typeof event.source === "string" ? event : null;
  } catch {
    return null;
  }
}
function fit(list, columns) {
  const out = [];
  let used = 0;
  for (let i = list.length - 1;i >= 0; i--) {
    const width = clip(list[i].text).length + 4;
    if (out.length && used + width > columns)
      break;
    out.unshift(list[i]);
    used += width;
  }
  return out;
}
var ticker;
async function record($, event) {
  await update($, chips, (list) => applyEvent(list, event));
  const now = await update($, stats, (s) => applyStats(s, event));
  if (now.inFlight > 0 && !ticker)
    ticker = $.clock.every(100, () => update($, frame, (f) => f + 1));
  if (now.inFlight === 0 && ticker) {
    ticker.cancel();
    ticker = undefined;
  }
}
async function togglePause($) {
  const paused = await update($, isPaused, (p) => !p);
  await $.env.set("JEV_PAUSED", paused ? "1" : undefined);
}
function register(on) {
  on("ui.log", async ($, e, next) => {
    if (e.text.startsWith("jev · "))
      return next({ ...e, to: "debug" });
    if (e.text.startsWith(EVENT_PREFIX)) {
      const event = parse(e.text);
      if (event)
        await record($, event);
    }
    return next(e);
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey)
      return next(e);
    const list = await read($, chips);
    const paused = await read($, isPaused);
    const s = await read($, stats);
    const spin = SPINNER[await read($, frame) % SPINNER.length];
    const columns = e.props.bodyColumns ?? 80;
    const shown = fit(list, columns);
    const { Box, Button, Text } = $.ui.resolve(e);
    const avg = s.calls ? Math.round(s.ms / s.calls) : 0;
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column"
    }, await next(e), /* @__PURE__ */ h(Box, {
      justifyContent: "space-between",
      width: columns
    }, /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, {
      color: paused ? "warning" : "claude",
      bold: true
    }, paused ? "⏸" : s.inFlight ? spin : "◆", " jev"), /* @__PURE__ */ h(Text, {
      dimColor: true
    }, "  ", s.calls, " calls · ", avg, " ms avg · $", s.usd.toFixed(5), s.blocks ? ` · ${s.blocks} blocked` : "")), /* @__PURE__ */ h(Button, {
      key: "pause",
      hotkey: "p",
      dimColor: !paused,
      label: paused ? "Resume" : "Pause",
      onPress: () => togglePause($)
    })), paused && /* @__PURE__ */ h(Text, {
      color: "warning"
    }, "paused · no gate, screen or compaction advice until you resume"), /* @__PURE__ */ h(Box, null, shown.map((c, i) => /* @__PURE__ */ h(Text, {
      key: `${i}`,
      color: COLOR[c.tone],
      bold: i === shown.length - 1,
      wrap: "truncate"
    }, c.isPending ? spin : ICON[c.tone], " ", clip(c.text), i < shown.length - 1 ? "   " : ""))));
  });
}
export {
  register,
  applyStats,
  applyEvent
};
