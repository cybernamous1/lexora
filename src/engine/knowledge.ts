// Adaptive knowledge: aggregated feedback on predefined rule ids + curated, versioned shards.
// Nothing here ever handles user text. Everything coming from D1 is treated as untrusted input
// and validated here before it can influence a transformation.
import { ENGINE_VERSION, RULE_IDS, type Rule, type Variant } from "./rules.ts";
import type { Intensity, Knowledge, LearnedScore, Shard, Standard } from "./types.ts";

export const APPLY_THRESHOLD = 0.55;     // a rule whose effective confidence falls below this is skipped
export const MIN_FEEDBACK_VOTES = 10;    // feedback with fewer votes has no influence at all
export const MIN_SHARD_CONFIDENCE = 0.7; // curated shards below this confidence are ignored
const STANDARDS: Standard[] = ["filipino-basic", "filipino-conversational", "filipino-academic", "filipino-professional", "natural-global"];

/** Wilson score lower bound (90%) of the positive rate. */
export function wilsonLower(pos: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.645, p = pos / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

/**
 * Feedback can move a rule's confidence by at most ±0.2, and only once enough votes exist.
 * It can therefore retire a borderline rule but can never switch off a well-established one.
 */
export function feedbackAdjust(score: LearnedScore | undefined): { adj: number; boost: boolean } {
  if (!score) return { adj: 0, boost: false };
  const pos = Math.max(0, Math.floor(score.positive)), neg = Math.max(0, Math.floor(score.negative));
  const n = pos + neg;
  if (n < MIN_FEEDBACK_VOTES) return { adj: 0, boost: false };
  const lb = wilsonLower(pos, n);
  return { adj: Math.max(-0.2, Math.min(0.2, (lb - 0.5) * 0.4)), boost: lb >= 0.7 };
}

const CRITICAL = new Set(["can", "could", "will", "would", "shall", "should", "may", "might", "must", "all", "every", "always", "only", "most", "some", "never", "few", "not", "no", "none", "both", "neither", "nor", "either"]);
const FROM_RE = /^[a-z]+(?:['’ -][a-z]+){0,5}$/;
const TO_RE = /^[a-z]+(?:['’ ,-][a-z]+){0,5}$/;
const ID_RE = /^[a-z0-9-]{3,60}$/;

export interface LexiconPair { from: string; to: string }

/** Returns the pairs of a lexicon shard that pass the safety checks (or null if the shard is invalid). */
export function validateLexicon(payload: unknown): { pairs: LexiconPair[]; intensity: Intensity; rejected: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { pairs?: unknown; intensity?: unknown };
  if (!Array.isArray(p.pairs) || p.pairs.length === 0 || p.pairs.length > 200) return null;
  const intensity: Intensity = p.intensity === "strong" ? "strong" : "balanced"; // shards never run at "light"
  const pairs: LexiconPair[] = [];
  let rejected = 0;
  for (const raw of p.pairs) {
    const e = raw as { from?: unknown; to?: unknown };
    const from = typeof e?.from === "string" ? e.from.trim().toLowerCase() : "";
    const to = typeof e?.to === "string" ? e.to.trim().toLowerCase() : "";
    const wf = from.split(/\s+/), wt = to.split(/\s+/);
    const okShape = FROM_RE.test(from) && TO_RE.test(to) && from !== to && wt.length <= wf.length + 1;
    const critFrom = wf.filter(w => CRITICAL.has(w)).sort().join(","), critTo = wt.filter(w => CRITICAL.has(w)).sort().join(",");
    // A rewrite must neither drop nor add negations, modals or quantifiers.
    if (!okShape || critFrom !== critTo) { rejected++; continue; }
    pairs.push({ from, to });
  }
  return pairs.length ? { pairs, intensity, rejected } : null;
}

export interface KnowledgeState {
  tuning: Map<string, number>;
  boost: Set<string>;
  adjustments: Map<string, number>;
  shardRules: Rule[];
  shardsUsed: number;
  shardsRejected: number;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Validate and fold raw knowledge (scores + shards) into data the transformer can use. */
export function prepareKnowledge(k: Knowledge | undefined): KnowledgeState {
  const state: KnowledgeState = { tuning: new Map(), boost: new Set(), adjustments: new Map(), shardRules: [], shardsUsed: 0, shardsRejected: 0 };
  if (!k) return state;
  for (const [id, score] of Object.entries(k.scores ?? {})) {
    if (!RULE_IDS.has(id)) continue;
    const { adj, boost } = feedbackAdjust(score);
    if (adj) state.adjustments.set(id, adj);
    if (boost) state.boost.add(id);
  }
  // Highest valid version of each shard id wins.
  const latest = new Map<string, Shard>();
  for (const s of k.shards ?? []) {
    if (!s || typeof s.id !== "string" || !ID_RE.test(s.id) || !Number.isInteger(s.version) || s.version < 1) { state.shardsRejected++; continue; }
    const cur = latest.get(s.id);
    if (!cur || s.version > cur.version) latest.set(s.id, s);
  }
  for (const s of latest.values()) {
    const conf = typeof s.confidence === "number" ? s.confidence : 0;
    if (conf < MIN_SHARD_CONFIDENCE || conf > 1 || (s.engineMin ?? 1) > ENGINE_VERSION) { state.shardsRejected++; continue; }
    const standards = Array.isArray(s.standards) ? s.standards.filter((x): x is Standard => STANDARDS.includes(x)) : undefined;
    if (s.kind === "tuning") {
      const rules = (s.payload as { rules?: Record<string, unknown> } | null)?.rules;
      if (!rules || typeof rules !== "object") { state.shardsRejected++; continue; }
      for (const [id, d] of Object.entries(rules)) {
        if (RULE_IDS.has(id) && typeof d === "number" && Number.isFinite(d)) {
          state.tuning.set(id, (state.tuning.get(id) ?? 0) + Math.max(-0.3, Math.min(0.3, d)));
        }
      }
      state.shardsUsed++;
    } else if (s.kind === "lexicon") {
      const lex = validateLexicon(s.payload);
      if (!lex) { state.shardsRejected++; continue; }
      const variants: Variant[] = lex.pairs.map(p => ({
        re: new RegExp(`\\b(?:${esc(p.from).replace(/ /g, "\\s+")})\\b`, "gi"),
        to: p.to
      }));
      state.shardRules.push({
        id: `shard-${s.id}`, category: "wordiness", intensity: lex.intensity, confidence: conf, since: s.version,
        phase: 3, only: standards?.length ? standards : undefined, variants
      });
      state.shardsUsed++;
      state.shardsRejected += lex.rejected;
    } else state.shardsRejected++;
  }
  return state;
}
