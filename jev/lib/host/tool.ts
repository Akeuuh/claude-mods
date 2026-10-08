import type { ToolCallResult } from "claude-code";

export const ok = (payload: unknown): ToolCallResult => ({ result: JSON.stringify(payload, null, 2) });
export const fail = (message: string): ToolCallResult => ({ deny: message });
export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
