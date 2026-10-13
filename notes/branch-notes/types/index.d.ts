export type NotesView = { branch: string; file: string; text: string };

declare module "claude-code" {
  interface PluginState {
    "branch-notes": { view: NotesView | null };
  }
}
