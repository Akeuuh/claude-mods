/**
 * Bundles every mod's src/register.ts into its hooks/register.js. A hooks module imports only files
 * of its own plugin and runs without Node, so the family's shared lib is inlined into each mod.
 *
 *   bun run build           build every <family>/<mod>/
 *   bun run build <dir>     also copy each built mod to <dir>/<plugin name>/, for example a dev-mods folder
 */
import { cp } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const entries = [...new Bun.Glob("*/*/src/register.{ts,tsx}").scanSync(root)].sort();

for (const entry of entries) {
  const mod = join(root, dirname(dirname(entry)));
  const result = await Bun.build({ entrypoints: [join(root, entry)], target: "browser", format: "esm", external: ["claude-code"] });
  if (!result.success) throw new AggregateError(result.logs, `${entry}: build failed`);
  await Bun.write(join(mod, "hooks/register.js"), result.outputs[0]);

  const out = process.argv[2];
  if (out) {
    const { name } = await Bun.file(join(mod, ".claude-plugin/plugin.json")).json();
    await cp(join(mod, ".claude-plugin"), join(out, name, ".claude-plugin"), { recursive: true });
    await cp(join(mod, "hooks"), join(out, name, "hooks"), { recursive: true });
  }
  console.log(dirname(dirname(entry)));
}
