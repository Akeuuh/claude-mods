export const SECTIONS = [
  { key: "objectif", heading: "Objectif", aliases: ["objectif", "objective", "goal"] },
  { key: "decisions", heading: "Décisions", aliases: ["decisions", "décisions", "decision", "décision"] },
  { key: "contraintes", heading: "Contraintes", aliases: ["contraintes", "constraints", "constraint"] },
  { key: "etat", heading: "État / prochaines étapes", aliases: ["etat", "état", "state", "status", "next"] },
] as const;

export type Section = (typeof SECTIONS)[number];

export const LONG_LIVED = new Set(["main", "master", "develop"]);

export const slugOf = (branch: string) => encodeURIComponent(branch);

export const branchOf = (slug: string) => decodeURIComponent(slug);

export const sectionOf = (name: string): Section | undefined => {
  const wanted = name.trim().toLowerCase();
  return SECTIONS.find((s) => s.aliases.some((alias) => alias === wanted));
};

export const repoOf = (commonDir: string) => {
  const parts = commonDir.trim().split("/");
  const last = parts.pop() ?? "";
  return last === ".git" ? (parts.pop() ?? "") : last.replace(/\.git$/, "");
};

export const template = (repo: string, branch: string, date: string) =>
  [`# Notes — ${repo} @ ${branch}`, `Créé : ${date}`, ...SECTIONS.map((s) => `## ${s.heading}`)].join("\n\n") + "\n";

type Block = { heading: string; body: string[] };
type Doc = { preamble: string[]; blocks: Block[] };

const parse = (text: string): Doc => {
  const doc: Doc = { preamble: [], blocks: [] };
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) doc.blocks.push({ heading: line.slice(3).trim(), body: [] });
    else (doc.blocks.at(-1)?.body ?? doc.preamble).push(line);
  }
  return doc;
};

const trimmed = (lines: readonly string[]) => {
  const kept = [...lines];
  while (kept.at(-1)?.trim() === "") kept.pop();
  while (kept[0]?.trim() === "") kept.shift();
  return kept;
};

const print = (doc: Doc) =>
  [trimmed(doc.preamble).join("\n"), ...doc.blocks.map((b) => ["## " + b.heading, ...trimmed(b.body)].join("\n"))]
    .filter(Boolean)
    .join("\n\n") + "\n";

export const bodyOf = (text: string, section: Section) =>
  trimmed(parse(text).blocks.find((b) => b.heading === section.heading)?.body ?? []);

export const withEntry = (text: string, section: Section, entry: string, replace: boolean) => {
  const doc = parse(text);
  let block = doc.blocks.find((b) => b.heading === section.heading);
  if (!block) {
    block = { heading: section.heading, body: [] };
    doc.blocks.push(block);
  }
  const line = `- ${entry.trim().replace(/\s*\n\s*/g, " ")}`;
  block.body = replace ? [line] : [...trimmed(block.body), line];
  return print(doc);
};

export const filledSections = (text: string) =>
  parse(text)
    .blocks.map((b) => ({ heading: b.heading, body: trimmed(b.body) }))
    .filter((b) => b.body.length > 0);

const KEPT_HEAD_LINES = 10;
const KEPT_TAIL_LINES = 15;

const clipLines = (lines: readonly string[]) => {
  const omitted = lines.length - KEPT_HEAD_LINES - KEPT_TAIL_LINES;
  if (omitted <= 0) return lines;
  return [...lines.slice(0, KEPT_HEAD_LINES), `… ${omitted} more line(s) in the notes file`, ...lines.slice(-KEPT_TAIL_LINES)];
};

export const forPrompt = (text: string) =>
  filledSections(text)
    .map((b) => `## ${b.heading}\n${clipLines(b.body).join("\n")}`)
    .join("\n\n");

export const firstEntry = (text: string, key: Section["key"]) =>
  (bodyOf(text, SECTIONS.find((s) => s.key === key) as Section)[0] ?? "").replace(/^-\s*/, "");

export const branchSlugsOf = (refs: string) =>
  new Set(
    refs
      .split("\n")
      .map((ref) => ref.match(/^refs\/(?:heads|remotes\/[^/]+)\/(.+)$/)?.[1])
      .filter((name): name is string => name !== undefined && name !== "HEAD")
      .map(slugOf),
  );
