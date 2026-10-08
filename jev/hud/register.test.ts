import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

const BAND = { component: "AbovePrompt", props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } } as const;

function engineBelow(on: On, onLog: (to: string) => void = () => {}) {
  const clock = mock.clock(on);
  on("ui.log", ($, e) => {
    onLog(e.to);
    return { value: undefined };
  });
  on("ui.render", ($, e) => {
    const { Box } = $.ui.resolve(e);
    return h(Box, null);
  });
  return clock;
}

/** Stand for a jev mod: a tool call that logs what lib/host/jev.ts logs. Inline plugins share no variables with the test. */
const blockingJevMod = {
  name: "fake-jev",
  register: (on: On) => {
    on("tool.call", { tool: "Probe" }, ($) => {
      $.ui.log('jev-event {"kind":"start","source":"tool.call Bash"}', { to: "debug" });
      $.ui.log('jev-event {"kind":"done","source":"tool.call Bash","ms":310,"usd":0.00002,"brief":"effect irreversible 0.90","isError":false}', { to: "debug" });
      $.ui.log('jev-event {"kind":"verdict","source":"tool.call Bash","text":"Bash blocked · irreversible (0.90)","tone":"block"}', { to: "debug" });
      return { result: "ok" };
    });
  },
};

const loggingJevMod = {
  name: "fake-jev",
  register: (on: On) => {
    on("tool.call", { tool: "Probe" }, ($) => {
      $.ui.log("jev · tool.call Bash · effect read_only 0.95 · 300 ms");
      return { result: "ok" };
    });
  },
};

test("a gate call and its verdict show as one blocked chip, with the totals", { plugins: [blockingJevMod] }, async ($, on) => {
  const clock = engineBelow(on);

  await $.tool.call({ tool: "Probe" });
  await clock.settle();

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev-hud", surface, ...BAND });
    expect(await ui.find({ type: "Text", text: /⛔ Bash blocked · irreversible \(0\.90\)/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /1 calls · 310 ms avg · \$0\.00002 · 1 blocked/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /effect irreversible/ })).toBeUndefined();
    await ui.unmount();
  }
});

test("the readable jev line leaves the transcript for the debug log", { plugins: [loggingJevMod] }, async ($, on) => {
  let to: string | undefined;
  engineBelow(on, (sink) => (to = sink));

  await $.tool.call({ tool: "Probe" });

  expect(to).toBe("debug");
});

test("the pause button switches JEV_PAUSED for the process, and back", async ($, on) => {
  engineBelow(on);
  const sets: { name: string; value?: string }[] = [];
  on("env.set", ($, e) => {
    sets.push({ name: e.name, value: e.value });
    return { value: undefined };
  });

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev-hud", surface, ...BAND });
    await ui.press({ key: "pause" });
    expect(await ui.find({ type: "Text", text: /paused · no gate/ })).toBeDefined();
    await ui.press({ key: "pause" });
    expect(await ui.find({ type: "Text", text: /paused · no gate/ })).toBeUndefined();
    await ui.unmount();
  }

  expect(sets).toEqual([
    { name: "JEV_PAUSED", value: "1" },
    { name: "JEV_PAUSED", value: undefined },
    { name: "JEV_PAUSED", value: "1" },
    { name: "JEV_PAUSED", value: undefined },
  ]);
});
