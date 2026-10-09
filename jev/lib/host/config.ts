/**
 * The family's config file, ~/.config/claude-mods/jev.json, one section per mod. Only the user edits it.
 * JEV_LEVEL_CONFIG, when set, overrides the same section key by key.
 */
import type { EngineInterface } from "claude-code";

export const CONFIG_FILE = ".config/claude-mods/jev.json";

const section = (raw: string, key: string): object => {
  const value = (JSON.parse(raw) as Record<string, unknown>)[key] ?? {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`"${key}" must be an object`);
  return value;
};

/** A missing file is the fallback; a file that does not parse throws, and the caller decides what that means. */
export async function familyConfig<T extends object>($: EngineInterface, key: string, fallback: T): Promise<T> {
  const home = await $.env.get("HOME");
  const file = home ? `${home}/${CONFIG_FILE}` : undefined;
  const fromFile = file && (await $.fs.exists(file)) ? section(await $.fs.read(file), key) : {};
  const env = await $.env.get("JEV_LEVEL_CONFIG");
  const fromEnv = env ? section(env, key) : {};
  return { ...fallback, ...fromFile, ...fromEnv };
}
