# Changelog

## 1.1.0 — linguistic engine upgrade

### Changed files
| File | Why |
|---|---|
| `src/engine/rules.ts` | Rewritten rule table: 13 → 83 rules with id, category, intensity, prior confidence, phase, per-standard replacements and context guards. All 13 original ids kept. Fixed wrong outputs of v1.0.0 rules (`for the purpose of testing` → `to testing`, `a matter of great importance` → `of very important`, `many knowledge`, mid-sentence `Also,` capitalisation). |
| `src/engine/transform.ts` | Pipeline rewritten: paragraph/line/list/heading handling, sentence-level processing, protected spans, rotating transitions, sentence splitting, staged validation with fallback, confidence-gated rule selection, richer notes. Fixed spacing bugs (`1,000` → `1, 000`, `Ph.D` → `Ph. D`, `10:30`). Signature: 4th argument is now `Knowledge` (scores + shards). |
| `src/engine/analyzer.ts` | Abbreviation-aware sentences, Flesch/FK readability, repeated openers, short-sentence runs, stock phrases, better passive detection. Original fields kept. |
| `src/engine/knowledge.ts` | Replaced the unused `buildAggregateSignals` with feedback confidence scoring (Wilson bound, ±0.2 cap, min 10 votes) and shard validation/versioning. |
| `src/engine/types.ts` | `Knowledge`, `Shard`, `LearnedScore`, `TransformStats`; `TransformResult.stats`. |
| `src/engine/sentences.ts` (new) | Sentence/paragraph segmentation, heading/list detection, protected-span masking. |
| `src/engine/validate.ts` (new) | Meaning-preservation checks. |
| `src/io.ts` (new) | BOM/CRLF normalisation; DOCX builder that keeps single line breaks. |
| `src/worker/index.ts` | Rule-id allow-list now imported from the engine (single source of truth); shard serving with independent degradation; stricter feedback validation (exact keys, 512-byte cap); tolerates a missing `DB` binding; short private cache on knowledge. |
| `migrations/0002_knowledge_shards.sql` (new) | Versioned, confidence-scored shard table + one seed lexicon shard. `0001` untouched. |
| `src/main.ts` | Uses new engine/knowledge, 4 s knowledge timeout, shard ids never sent as feedback, BOM/CRLF-safe TXT/DOCX import, DOCX export via `io.ts`. **Removed unused `HeadingLevel` import — with `noUnusedLocals` the v1.0.0 file fails `tsc -b`.** Removed the `void` no-ops. UI unchanged. |
| `package.json` | Version 1.1.0, `npm test`, `engines.node >=22.18` (native TypeScript for tests only). No new dependencies. |
| `tests/*.test.ts` (new) | 32 tests. |
| `README.md`, `DEPLOYMENT_CHECKLIST.md` | Document the engine, knowledge model, tests, migration step. |

Unchanged: `wrangler.jsonc`, `tsconfig.json`, `index.html`, `src/styles.css`, `migrations/0001_initial.sql`, `.npmrc`, `.gitignore`.

### Behaviour changes worth knowing
- Academic standard no longer rewrites "In conclusion" → "In summary", and keeps "approximately" (as before); professional also keeps "approximately".
- Transitions are replaced only at sentence start (or after `;`) and never repeat the same replacement in nearby sentences; when no non-repeating alternative remains the original is kept.
- Import imports now strip a BOM and normalise CRLF.
