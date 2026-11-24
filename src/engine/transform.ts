import { analyzeText } from "./analyzer.ts";
import { prepareKnowledge, APPLY_THRESHOLD } from "./knowledge.ts";
import { RULES, RULE_META, type Ctx, type Rule, type To, type PerStandard } from "./rules.ts";
import { isHeadingLike, listPrefix, maskProtected, splitBlocks, splitSentences, words } from "./sentences.ts";
import type { Intensity, Knowledge, Standard, TransformResult, TransformStats } from "./types.ts";
import { validateSentence } from "./validate.ts";

const RANK: Record<Intensity, number> = { light: 0, balanced: 1, strong: 2 };

// Sentences longer than this (in words) are candidates for splitting. "light" never restructures.
const SPLIT_AT: Record<Exclude<Intensity, "light">, Record<Standard, number>> = {
  balanced: { "filipino-basic": 24, "filipino-conversational": 26, "filipino-academic": 40, "filipino-professional": 32, "natural-global": 32 },
  strong: { "filipino-basic": 18, "filipino-conversational": 20, "filipino-academic": 32, "filipino-professional": 26, "natural-global": 26 }
};

// ------------------------------- rule application -------------------------------
interface Env { standard: Standard; intensity: Intensity; apos: string; used: Map<string, string[]> }

function fitCase(matched: string, repl: string): string {
  if (!repl) return repl;
  const letters = matched.replace(/[^A-Za-z]/g, "");
  if (letters.length > 1 && letters === letters.toUpperCase() && /[A-Z]/.test(letters)) return repl.toUpperCase();
  if (/^[A-Z]/.test(matched) && /^[a-z]/.test(repl)) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

function resolve(to: To | PerStandard, standard: Standard): To {
  if (to && typeof to === "object" && !Array.isArray(to)) return standard in to ? (to[standard] as To) : to.default;
  return to as To;
}

function applyRule(text: string, rule: Rule, env: Env, applied: Map<string, number>): string {
  for (const variant of rule.variants) {
    text = text.replace(variant.re, (...args: unknown[]) => {
      const str = args[args.length - 1] as string;
      const offset = args[args.length - 2] as number;
      const match = args[0] as string;
      const g = (args.slice(1, -2) as Array<string | undefined>).map(x => x ?? "");
      const before = str.slice(0, offset), after = str.slice(offset + match.length);
      const ctx: Ctx = {
        matched: match, before, after, standard: env.standard, intensity: env.intensity, apos: env.apos,
        atStart: /^[\s"“‘'(\[]*$/.test(before),
        prev: (before.match(/([\p{L}'’-]+)\s*$/u)?.[1] ?? "").toLowerCase(),
        next: (after.match(/^\s*([\p{L}'’-]+)/u)?.[1] ?? "").toLowerCase()
      };
      if (variant.guard && !variant.guard(ctx)) return match;
      const to = resolve(variant.to, env.standard);
      let repl: string | null | undefined;
      if (to === null || to === undefined) return match;
      if (typeof to === "function") repl = to(g, ctx);
      else if (Array.isArray(to)) {
        const key = rule.group ?? rule.id;
        const recent = env.used.get(key) ?? [];
        repl = to.find(alt => !recent.slice(-2).includes(alt));
        if (repl) env.used.set(key, [...recent, repl]);
      } else repl = to.replace(/\$(\d)/g, (_m, i) => g[Number(i) - 1] ?? "");
      if (repl === null || repl === undefined) return match;
      const out = fitCase(match, repl);
      if (out === match) return match;
      applied.set(rule.id, (applied.get(rule.id) ?? 0) + 1);
      return out;
    });
  }
  return text;
}

/** Whitespace/punctuation hygiene that is safe around numbers, URLs (masked) and abbreviations. */
function tidy(text: string): string {
  return text
    .replace(/(?<=\S)[ \t]{2,}(?=\S)/g, " ")
    .replace(/(?<=[\p{L}\p{N}"”’)])[ \t]+(?=[,;.!?])(?![.]{2})/gu, "")
    .replace(/,{2,}/g, ",")
    .replace(/(?<=[\p{L}]{3})\.(?=[A-Z][a-z]{2,})/gu, ". ")
    .replace(/(?<=\p{L}),(?=\p{L})/gu, ", ");
}

// ------------------------------- restructuring -------------------------------
const SUBJ = new Set(["i", "we", "you", "they", "he", "she", "it", "there", "the", "this", "these", "those", "our", "their", "his", "her", "its", "my", "your", "many", "some", "most", "each", "people", "students", "teachers"]);
const AUX = new Set(["is", "are", "was", "were", "be", "been", "has", "have", "had", "do", "does", "did", "will", "would", "can", "could", "should", "may", "might", "must", "am", "cannot"]);
const VERBS = new Set(("accept add allow ask become begin believe bring build buy call care carry change check choose come consider continue create cut decide develop do expect explain feel find follow get give go grow happen have help hold hope improve include increase keep know learn leave let like live look lose make mean meet move need offer open pay plan play provide put reach read receive remember report require run say see seem send set show start stay stop study succeed support take talk tell think try turn understand use wait walk want watch work write").split(" "));
function hasFiniteVerb(clause: string): boolean {
  return words(clause.toLowerCase()).some(w => AUX.has(w) || VERBS.has(w) || VERBS.has(w.replace(/(?:es|s|ed|d|ing)$/, "")) || (w.length > 4 && /ed$/.test(w)) || /n['’]t$/.test(w));
}
const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;
const depthOk = (s: string) => (s.split("(").length === s.split(")").length);
const upFirst = (s: string) => s.replace(/^(\s*)([a-z])/, (_m, a: string, b: string) => a + b.toUpperCase());

function findSplit(text: string, standard: Standard): string | null {
  const formal = standard === "filipino-academic" || standard === "filipino-professional";
  type Cand = { left: string; right: string; conn: string; semi: boolean };
  const cands: Cand[] = [];
  const consider = (idx: number, len: number, conn: string, semi: boolean, minL: number, minR: number, needVerbs: boolean) => {
    const left = text.slice(0, idx), right = text.slice(idx + len);
    if (wc(left) < minL || wc(right) < minR || !depthOk(left)) return;
    if (needVerbs && (!hasFiniteVerb(left) || !hasFiniteVerb(right))) return;
    cands.push({ left, right, conn, semi });
  };
  for (const m of text.matchAll(/;\s+/g)) consider(m.index!, m[0].length, "", true, 5, 5, false);
  const starts = (right: string, set: Set<string>) => set.has((right.match(/^[A-Za-z']+/)?.[0] ?? "").toLowerCase());
  for (const m of text.matchAll(/,\s+(but|yet)\s+/gi)) {
    const right = text.slice(m.index! + m[0].length);
    if (starts(right, SUBJ)) consider(m.index!, m[0].length, formal ? "However, " : "But ", false, 6, 5, true);
  }
  const noThat = new Set([...SUBJ].filter(x => x !== "that"));
  for (const m of text.matchAll(/,\s+so\s+/gi)) {
    const right = text.slice(m.index! + m[0].length);
    if (starts(right, noThat)) consider(m.index!, m[0].length, formal ? "As a result, " : "So ", false, 6, 5, true);
  }
  for (const m of text.matchAll(/,\s+and\s+/gi)) {
    const right = text.slice(m.index! + m[0].length);
    if (starts(right, SUBJ)) consider(m.index!, m[0].length, standard === "filipino-conversational" ? "And " : "", false, 8, 8, true);
  }
  if (!cands.length) return null;
  const semis = cands.filter(c => c.semi);
  const pool = semis.length ? semis : cands;
  pool.sort((a, b) => Math.abs(wc(a.left) - wc(a.right)) - Math.abs(wc(b.left) - wc(b.right)));
  const best = pool[0];
  const right = best.conn ? best.conn + best.right : upFirst(best.right);
  return `${best.left.replace(/[\s,;]+$/, "")}. ${/^\uE000/.test(right) ? right : upFirst(right)}`;
}

function restructure(text: string, env: Env): { text: string; splits: number } {
  if (env.intensity === "light") return { text, splits: 0 };
  const limit = SPLIT_AT[env.intensity][env.standard];
  let splits = 0;
  for (let i = 0; i < 3 && wc(text) > limit; i++) {
    const next = findSplit(text, env.standard);
    if (!next) break;
    text = next; splits++;
  }
  return { text, splits };
}

// ------------------------------- rule selection -------------------------------
function selectRules(standard: Standard, intensity: Intensity, knowledge: Knowledge | undefined) {
  const ks = prepareKnowledge(knowledge);
  const active: Rule[] = [];
  let suppressed = 0;
  for (const rule of [...RULES, ...ks.shardRules]) {
    if (rule.only && !rule.only.includes(standard)) continue;
    if (rule.not?.includes(standard)) continue;
    const eff = Math.max(0, Math.min(1, rule.confidence + (ks.tuning.get(rule.id) ?? 0) + (ks.adjustments.get(rule.id) ?? 0)));
    if (eff < APPLY_THRESHOLD) { suppressed++; continue; }
    const boost = ks.boost.has(rule.id) && eff >= 0.85 ? 1 : 0;
    if (RANK[rule.intensity] > RANK[intensity] + boost) continue;
    active.push(rule);
  }
  active.sort((a, b) => a.phase - b.phase); // stable
  return { active, ks, suppressed };
}

// ------------------------------- main entry -------------------------------
export function transformText(input: string, standard: Standard, intensity: Intensity, knowledge?: Knowledge): TransformResult {
  const empty: TransformStats = { rules: {}, splits: 0, reverted: 0, sentences: 0, shardsUsed: 0, shardsRejected: 0 };
  if (!input.trim()) return { text: input, changes: 0, notes: ["Enter text to begin."], patternKeys: [], stats: empty };

  const source = input.replace(/\r\n?/g, "\n");
  const { active, ks, suppressed } = selectRules(standard, intensity, knowledge);
  const apos = /’/.test(source) && !/'/.test(source) ? "’" : "'";
  const stats: TransformStats = { ...empty, rules: {}, shardsUsed: ks.shardsUsed, shardsRejected: ks.shardsRejected };

  const commit = (m: Map<string, number>) => { for (const [id, n] of m) stats.rules[id] = (stats.rules[id] ?? 0) + n; };

  function processSentence(piece: string, env: Env): string {
    const lead = piece.match(/^\s*/)![0], trail = piece.match(/\s*$/)![0];
    const core = piece.trim();
    const letters = core.replace(/[^A-Za-z]/g, "");
    if (words(core).length < 2 || (letters.length > 3 && letters === letters.toUpperCase())) return piece;
    stats.sentences++;

    const { masked, restore } = maskProtected(core);
    const a1 = new Map<string, number>();
    let m1 = masked;
    for (const rule of active) m1 = applyRule(m1, rule, env, a1);
    m1 = tidy(m1);
    const r1 = restore(m1);
    const a2 = new Map(a1);
    const re = restructure(m1, env);
    const r2 = restore(re.text);

    if (r2 !== core && validateSentence(core, r2)) { commit(a2); stats.splits += re.splits; return lead + r2 + trail; }
    if (r1 !== core && validateSentence(core, r1)) { commit(a1); if (r2 !== r1) stats.reverted++; return lead + r1 + trail; }
    if (r1 !== core || r2 !== core) stats.reverted++;
    return piece;
  }

  function processParagraph(body: string): string {
    const env: Env = { standard, intensity, apos, used: new Map() };
    return splitSentences(body).map(s => processSentence(s, env)).join("");
  }

  function processLine(line: string): string {
    const prefix = listPrefix(line);
    const rest = line.slice(prefix.length);
    const indent = prefix ? "" : rest.match(/^\s*/)![0];
    const body = rest.slice(indent.length);
    if (!body.trim() || (!prefix && isHeadingLike(body)) || (prefix && isHeadingLike(body) && !/[a-z]/.test(body))) return line;
    return prefix + indent + processParagraph(body);
  }

  const output = splitBlocks(source).map(block => {
    if (block.separator || !block.text.trim()) return block.text;
    const lines = block.text.split("\n");
    if (lines.length === 1) return processLine(lines[0]);
    const structured = lines.some(l => listPrefix(l) || isHeadingLike(l));
    return structured ? lines.map(processLine).join("\n") : processLine(block.text);
  }).join("");

  const before = analyzeText(source);
  const after = analyzeText(output);
  const changes = Object.values(stats.rules).reduce((a, b) => a + b, 0) + stats.splits;
  const patternKeys = Object.keys(stats.rules).filter(id => RULE_META.has(id));
  const notes = buildNotes({ before, after, stats, changes, standard, intensity, suppressed, knowledge, shardsUsed: ks.shardsUsed });
  return { text: output, changes, notes, patternKeys, stats };
}

function buildNotes(o: {
  before: ReturnType<typeof analyzeText>; after: ReturnType<typeof analyzeText>; stats: TransformStats; changes: number;
  standard: Standard; intensity: Intensity; suppressed: number; knowledge?: Knowledge; shardsUsed: number;
}): string[] {
  const { before, after, stats } = o;
  const notes: string[] = [];
  if (o.changes === 0) notes.push("No safe rule-based changes were found. The text was left unchanged.");
  else {
    const byCat = new Map<string, number>();
    for (const [id, n] of Object.entries(stats.rules)) {
      const raw = id.startsWith("shard-") ? "wordiness" : RULE_META.get(id)?.category ?? "wordiness";
      const cat = raw === "phrase" ? "wordiness" : raw;
      byCat.set(cat, (byCat.get(cat) ?? 0) + n);
    }
    if (stats.splits) byCat.set("sentence splits", stats.splits);
    const label: Record<string, string> = { grammar: "grammar", convention: "Philippine English usage", redundancy: "redundancy", wordiness: "wording", formalism: "vocabulary", transition: "transitions", cliche: "stock phrases", spelling: "spelling", style: "register", phrase: "wording", "sentence splits": "sentence splits" };
    notes.push(`${o.changes} change(s): ` + [...byCat].map(([c, n]) => `${label[c] ?? c} ${n}`).join(", ") + ".");
  }
  if (stats.reverted) notes.push(`${stats.reverted} edit(s) were rolled back because they could not be verified as meaning-preserving.`);
  if (before.sentences && after.sentences) {
    notes.push(`Readability (Flesch): ${before.readingEase} → ${after.readingEase}; average sentence ${before.avgWordsPerSentence} → ${after.avgWordsPerSentence} words.`);
  }
  if (after.longSentences > 0) notes.push(`${after.longSentences} long sentence(s) remain. Consider splitting them by hand.`);
  if (after.repeatedOpeners > 0) notes.push(`${after.repeatedOpeners} run(s) of 3+ sentences begin with the same word. Vary the openings.`);
  if (after.repeatedTransitions > 0) notes.push(`${after.repeatedTransitions} repeated sentence-opening transition(s) remain.`);
  if (after.shortRuns > 0) notes.push("Several very short sentences appear in a row. Consider combining some.");
  if (after.passiveLike > 2) notes.push(`${after.passiveLike} passive-style constructions found. Consider active voice where the actor matters.`);
  if (after.stockPhrases > 0) notes.push(`${after.stockPhrases} stock phrase(s) remain that often sound generic. Consider rewording by hand.`);
  if (o.shardsUsed) notes.push(`Curated knowledge shards in use: ${o.shardsUsed}.`);
  else if (!o.knowledge) notes.push("Built-in rules only (the optional knowledge store was not available).");
  if (o.suppressed) notes.push(`${o.suppressed} rule(s) are paused by low confidence.`);
  notes.push("This is rule-based editing, not a guarantee of human authorship or detector avoidance.");
  return notes;
}
