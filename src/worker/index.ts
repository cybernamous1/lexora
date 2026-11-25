import { ENGINE_VERSION, RULE_IDS, ruleCategory } from "../engine/rules.ts";

// Minimal local binding types so the build doesn't depend on global Cloudflare
// types (which clash with the DOM lib used by the front-end code).
interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
interface D1Like {
  prepare(query: string): D1StatementLike;
}
interface FetcherLike {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: FetcherLike;
  DB?: D1Like;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function parseJson(value: unknown, max = 20_000): unknown {
  if (typeof value !== "string" || value.length > max) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, product: "Lexora", mode: "rule-based", engine: ENGINE_VERSION, textRetention: false });
    }

    if (url.pathname === "/api/knowledge" && request.method === "GET") {
      // Each part degrades independently: the engine works with built-in rules alone.
      let patterns: unknown[] = [];
      let shards: unknown[] = [];
      let degraded = false;
      try {
        if (!env.DB) throw new Error("no D1 binding");
        const rows = await env.DB.prepare(
          "SELECT pattern_key, category, positive_count, negative_count FROM pattern_stats ORDER BY pattern_key LIMIT 500"
        ).all();
        patterns = rows.results ?? [];
      } catch { degraded = true; }
      try {
        if (!env.DB) throw new Error("no D1 binding");
        // Only the highest active version of each shard is served.
        const rows = await env.DB.prepare(`
          SELECT id, version, kind, confidence, engine_min, standards, payload FROM knowledge_shards s
          WHERE status = 'active'
            AND version = (SELECT MAX(version) FROM knowledge_shards WHERE id = s.id AND status = 'active')
          ORDER BY id LIMIT 50`).all();
        for (const r of (rows.results ?? []) as Array<Record<string, unknown>>) {
          const payload = parseJson(r.payload);
          if (payload === null) continue;
          shards.push({
            id: r.id, version: r.version, kind: r.kind, confidence: r.confidence, engineMin: r.engine_min,
            standards: parseJson(r.standards, 500) ?? undefined, payload
          });
        }
      } catch { degraded = true; shards = []; }
      return json({ version: 2, patterns, shards, ...(degraded ? { degraded: true } : {}) }, 200, { "cache-control": "private, max-age=300" });
    }

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      // Feedback accepts only a predefined rule id and a binary rating. It cannot carry text.
      if (Number(request.headers.get("content-length") ?? 0) > 512) return json({ error: "Request too large." }, 413);
      let body: Record<string, unknown>;
      try {
        const raw = await request.text();
        if (raw.length > 512) return json({ error: "Request too large." }, 413);
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch { return json({ error: "Invalid JSON." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => k !== "patternKey" && k !== "helpful")) {
        return json({ error: "Only patternKey and helpful are accepted." }, 400);
      }
      const patternKey = typeof body.patternKey === "string" ? body.patternKey : "";
      if (!RULE_IDS.has(patternKey) || typeof body.helpful !== "boolean") {
        return json({ error: "A known patternKey and boolean helpful value are required." }, 400);
      }
      try {
        if (!env.DB) throw new Error("no D1 binding");
        const column = body.helpful ? "positive_count" : "negative_count";
        await env.DB.prepare(`
          INSERT INTO pattern_stats (pattern_key, category, ${column})
          VALUES (?, ?, 1)
          ON CONFLICT(pattern_key) DO UPDATE SET
            ${column} = ${column} + 1,
            updated_at = CURRENT_TIMESTAMP
        `).bind(patternKey, ruleCategory(patternKey)).run();
        return json({ ok: true });
      } catch {
        return json({ ok: false, error: "Knowledge store is unavailable. No text was retained." }, 503);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  }
};
