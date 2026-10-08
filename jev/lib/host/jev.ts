/**
 * The one way a mod calls Jev, through the host: `$.env` for the key, `$.http.fetch` for the call.
 * Every decision is logged as a dim transcript line, the mod's version of the lab's side channel.
 */
import type { EngineInterface } from "claude-code";
import { validateRequest, type Answer, type Questions, type State } from "../core/types.ts";
import { DEFAULT_MODELS, ENDPOINTS, KEY_ENV, MAX_ATTEMPTS, RETRY_STATUSES, validateResponse, type JevProvider } from "../core/wire.ts";

export interface Decision {
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
  model: string;
  ms: number;
}

async function selectProvider($: EngineInterface): Promise<{ provider: JevProvider; key: string }> {
  const backend = (await $.env.get("JEV_BACKEND"))?.trim();
  const typesafe = (await $.env.get("TYPESAFE_API_KEY"))?.trim();
  const openrouter = (await $.env.get("OPENROUTER_API_KEY"))?.trim();
  const keys = { typesafe, openrouter };
  if (backend === "typesafe" || backend === "openrouter") {
    const key = keys[backend];
    if (!key) throw new Error(`Provider "${backend}" needs ${KEY_ENV[backend]}.`);
    return { provider: backend, key };
  }
  if (backend) throw new Error(`Unknown JEV backend "${backend}"; use openrouter or typesafe.`);
  if (typesafe) return { provider: "typesafe", key: typesafe };
  if (openrouter) return { provider: "openrouter", key: openrouter };
  throw new Error("No Jev credentials: set TYPESAFE_API_KEY or OPENROUTER_API_KEY.");
}

async function systemOne($: EngineInterface, state: State, questions: Questions) {
  const { provider, key } = await selectProvider($);
  const body = JSON.stringify({ model: DEFAULT_MODELS[provider], state, questions });
  for (let attempt = 1; ; attempt++) {
    const res = await $.http.fetch(ENDPOINTS[provider], {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      await $.clock.sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) throw new Error(`${provider} HTTP ${res.status}.${res.status === 401 ? ` Check the ${KEY_ENV[provider]} key.` : ""}`);
    const response: unknown = JSON.parse(res.text);
    validateResponse(response, questions);
    return response;
  }
}

const brief = (a: Answer) =>
  a.type === "noul" ? a.noul.toFixed(2) : a.type === "choice" ? `${a.choice} ${a.confidence.toFixed(2)}` : `${a.score.toFixed(2)}`;

/** One Jev call from a hook or a tool. `source` names who asked, so the log line says it. */
export async function decide($: EngineInterface, source: string, state: State, questions: Questions): Promise<Decision> {
  validateRequest({ state, questions });
  const started = await $.clock.now();
  const result = await systemOne($, state, questions);
  const ms = (await $.clock.now()) - started;
  const answers = Object.entries(result.answers).map(([id, a]) => `${id} ${brief(a)}`).join(", ");
  $.ui.log(`jev · ${source} · ${answers} · ${ms} ms`);
  return { answers: result.answers, usage: result.usage as Decision["usage"], model: result.model, ms };
}

/** The level config the lab passes to pi, read the same way. */
export async function levelConfig<T extends object>($: EngineInterface, fallback: T): Promise<T> {
  try {
    const raw = await $.env.get("JEV_LEVEL_CONFIG");
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}
