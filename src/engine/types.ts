export type Standard =
  | "filipino-basic"
  | "filipino-conversational"
  | "filipino-academic"
  | "filipino-professional"
  | "natural-global";

export type Intensity = "light" | "balanced" | "strong";

export interface TransformOptions {
  standard: Standard;
  intensity: Intensity;
}

export interface LearnedScore {
  positive: number;
  negative: number;
}

/** A curated, versioned unit of linguistic knowledge served by D1 (never user text). */
export interface Shard {
  id: string;
  version: number;
  kind: "lexicon" | "tuning";
  confidence: number;
  engineMin?: number;
  standards?: Standard[];
  payload: unknown;
}

/** Everything the engine may optionally learn from D1. All fields are optional. */
export interface Knowledge {
  scores?: Record<string, LearnedScore>;
  shards?: Shard[];
}

export interface TransformStats {
  rules: Record<string, number>;
  splits: number;
  reverted: number;
  sentences: number;
  shardsUsed: number;
  shardsRejected: number;
}

export interface TransformResult {
  text: string;
  changes: number;
  notes: string[];
  patternKeys: string[];
  stats: TransformStats;
}
