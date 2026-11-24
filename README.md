# Lexora — Natural Language Transformation Engine

A personal, experimental, AI-free writing tool built for Cloudflare Workers. It uses deterministic linguistic rules and optional aggregate feedback on predefined rule IDs. It is not an AI model, AI detector, or guaranteed human-authorship tool.

## Privacy model

- Text transformation happens in the browser.
- The Worker never receives submitted text or uploaded documents.
- TXT and DOCX files are read locally in the browser.
- TXT and DOCX exports are generated locally in the browser.
- D1 stores only aggregate positive/negative counters keyed by predefined transformation rule IDs.
- No user accounts, raw documents, source sentences, generated sentences, file names, or personal identifiers are stored.
- Feedback is optional. If you do not want any network writes, remove the feedback UI or leave it unused.

The Worker exposes:
- `GET /api/health`
- `GET /api/knowledge` — aggregate rule feedback plus the active curated knowledge shards. Degrades to an empty, `degraded: true` response if D1 is missing or not migrated.
- `POST /api/feedback` — accepts only `{ patternKey, helpful }` (exactly those two keys, under 512 bytes, `patternKey` must be a built-in rule id), never text.

## Requirements

- Node.js 20+
- A Cloudflare account
- Wrangler CLI (installed from package.json)

## Local development

```bash
npm install
npm run dev
```

The frontend runs in Vite. The Worker API is available in a deployed or Wrangler environment; the app still works without feedback/knowledge endpoints.

## Create D1 database

```bash
npx wrangler d1 create lexora-knowledge
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Apply migration locally:

```bash
npx wrangler d1 migrations apply lexora-knowledge --local
```

Apply migration to production:

```bash
npx wrangler d1 migrations apply lexora-knowledge --remote
```

## Build and deploy

```bash
npm run build
npx wrangler deploy
```

Cloudflare Workers serves the built static frontend and handles `/api/*` routes. No R2, KV, Durable Objects, external AI APIs, or separate backend server are required.

## Linguistic engine (v1.1)

Everything below runs in the browser; nothing here sends text anywhere.

- **Segmentation**: paragraph/line/list/heading detection, abbreviation-aware sentence splitting (Dr., Atty., Engr., Ph.D., a.m., e.g.), quotation-aware.
- **Protected spans**: quotations, URLs, e-mail addresses, `code`, @mentions and #tags are masked and never edited.
- **Rules** (`src/engine/rules.ts`, 80+ rules, each with an id, category, minimum intensity and prior confidence): grammar and article agreement, Philippine English usage fixes (e.g. *discuss about*, *looking forward to hear*, *cope up with*), redundancy, wordiness, context-guarded vocabulary swaps, rotating sentence-opening transitions, American spelling for the Filipino standards, contractions (conversational) / expansion (academic). Legitimate Philippine English (*kindly*, *comfort room*, *po*) is never "corrected", and no Filipino words are inserted.
- **Restructuring**: at Balanced/Strong, over-long sentences are split at `;`, `, but`, `, so` or `, and` only when both halves look like independent clauses; thresholds depend on the writing standard. Light never restructures.
- **Validation**: every edited sentence is checked against the original (numbers, negations, modals and quantifiers, proper nouns, quotations, brackets, length). A failing sentence falls back to a safer stage or to the original text.
- **Knowledge** (optional, `GET /api/knowledge`): effective confidence of a rule = prior + shard tuning + feedback adjustment (±0.2 max, only after 10+ votes, Wilson lower bound). Rules below 0.55 pause; core rules cannot be switched off by feedback. Curated **shards** (`knowledge_shards`, migration 0002) are versioned (highest active version wins), carry a confidence and a minimum engine version, and are re-validated in the browser (no dropped negations/modals/quantifiers, size limits) before use. Shards can only be added by maintainers through migrations; the public API cannot write them.

To add knowledge: write a new migration inserting a `knowledge_shards` row (`status = 'draft'` first, then promote to `'active'`), or add a rule to `src/engine/rules.ts` together with a regression test.

## Tests

```bash
npm test    # Node >= 22.18; engine, Worker (D1 emulated with node:sqlite) and DOCX/TXT tests
npm run build
```

## Important production notes

1. Lexora is a deterministic rule engine, not a language model. Its rules are deliberately conservative; every rule is a pattern with guards and no rule understands full sentence meaning.
2. The rule set should keep growing with carefully tested linguistic rules and regression examples in `tests/engine.test.ts`.
3. Do not add automatic storage of text examples to D1. Keep the database limited to aggregate pattern counters and curated, non-identifying linguistic knowledge.
4. The app is currently anonymous and publicly reachable at its Worker URL. For strictly personal access, protect the deployment with Cloudflare Access or another access-control layer. No login is implemented inside Lexora.
5. Cloudflare Free limits can change. Verify current CPU, request, D1 storage, and query limits before relying on a particular usage volume.
6. DOCX extraction uses Mammoth's raw-text extraction. Formatting is not preserved on import; paragraph breaks are preserved where the library exposes them. DOCX export creates a clean document from the transformed text.
7. No tool can guarantee that text will be indistinguishable from human writing or evade AI detectors. Lexora focuses on clarity, naturalness, and preserving meaning.

## Architecture

- `src/engine`: deterministic analysis and transformation (`rules`, `transform`, `sentences`, `validate`, `knowledge`, `analyzer`).
- `src/io.ts`: TXT normalization and DOCX export.
- `src/worker`: Worker API and D1 aggregate feedback.
- `src/main.ts`: browser interface, local file import/export.
- `migrations`: D1 schema.

## License

Personal-use starter project. Review and choose a license before public redistribution.
