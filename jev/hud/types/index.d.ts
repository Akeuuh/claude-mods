export type JevHudTone = "block" | "warn" | "ok" | "info" | "error";

export type JevHudChip = { source: string; text: string; tone: JevHudTone; isPending: boolean };

export type JevHudStats = { calls: number; inFlight: number; ms: number; usd: number; blocks: number };

declare module "claude-code" {
  interface PluginState {
    "jev-hud": { chips: JevHudChip[]; stats: JevHudStats; frame: number };
  }
}
