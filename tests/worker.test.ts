// Worker API tests. D1 is emulated with node:sqlite running the real migration files, so the real SQL is exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker/index.ts";
import { RULE_IDS } from "../src/engine/rules.ts";

function makeDb(migrations = ["0001_initial.sql", "0002_knowledge_shards.sql"]) {
  const sql = new DatabaseSync(":memory:");
  for (const m of migrations) sql.exec(readFileSync(new URL(`../migrations/${m}`, import.meta.url), "utf8"));
  const db = {
    prepare(q: string) {
      let args: unknown[] = [];
      const st = {
        bind(...a: unknown[]) { args = a; return st; },
        async all() { return { results: sql.prepare(q).all(...(args as never[])) }; },
        async run() { sql.prepare(q).run(...(args as never[])); return {}; }
      };
      return st;
    }
  };
  return { db: db as never, sql };
}
const assets = { fetch: async () => new Response("asset") } as never;
const call = (path: string, init: RequestInit | undefined, env: object) => worker.fetch(new Request(`https://lexora.test${path}`, init), env as never);
const post = (body: unknown, env: object) => call("/api/feedback", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }, env);

test("health reports no text retention", async () => {
  const r = await call("/api/health", undefined, { ASSETS: assets });
  const j = await r.json() as Record<string, unknown>;
  assert.equal(j.textRetention, false);
  assert.equal(j.engine, 2);
});

test("knowledge: serves patterns and the active shard from migrations", async () => {
  const { db } = makeDb();
  const j = await (await call("/api/knowledge", undefined, { DB: db, ASSETS: assets })).json() as any;
  assert.equal(j.version, 2);
  assert.equal(j.degraded, undefined);
  assert.equal(j.shards.length, 1);
  assert.equal(j.shards[0].id, "wordiness-extra");
  assert.equal(j.shards[0].payload.pairs.length, 10);
});

test("knowledge: only the highest ACTIVE version of a shard is served; drafts/retired are hidden", async () => {
  const { db, sql } = makeDb();
  const ins = sql.prepare("INSERT INTO knowledge_shards (id, version, kind, status, confidence, payload) VALUES (?, ?, 'lexicon', ?, 0.9, ?)");
  const p = (to: string) => JSON.stringify({ pairs: [{ from: "aaa bbb", to }] });
  ins.run("t", 1, "active", p("one")); ins.run("t", 2, "active", p("two")); ins.run("t", 3, "draft", p("three")); ins.run("u", 1, "retired", p("x"));
  ins.run("bad", 1, "active", "{not json");
  const j = await (await call("/api/knowledge", undefined, { DB: db, ASSETS: assets })).json() as any;
  const t = j.shards.find((s: any) => s.id === "t");
  assert.equal(t.version, 2);
  assert.equal(t.payload.pairs[0].to, "two");
  assert.equal(j.shards.some((s: any) => s.id === "u" || s.id === "bad"), false);
});

test("knowledge: degrades gracefully when D1 is missing, broken, or not migrated", async () => {
  const none = await call("/api/knowledge", undefined, { ASSETS: assets });
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { version: 2, patterns: [], shards: [], degraded: true });
  const broken = { prepare() { throw new Error("D1 down"); } };
  const r = await call("/api/knowledge", undefined, { DB: broken, ASSETS: assets });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as any).degraded, true);
  // v1-only database (migration 0002 not applied yet): patterns still served, shards empty.
  const { db } = makeDb(["0001_initial.sql"]);
  const old = await (await call("/api/knowledge", undefined, { DB: db, ASSETS: assets })).json() as any;
  assert.deepEqual(old.shards, []);
  assert.deepEqual(old.patterns, []);
});

test("feedback: stores only aggregate counters for known rule ids", async () => {
  const { db, sql } = makeDb();
  const env = { DB: db, ASSETS: assets };
  for (const helpful of [true, true, false]) assert.equal((await post({ patternKey: "phrase-utilize", helpful }, env)).status, 200);
  const row = sql.prepare("SELECT * FROM pattern_stats WHERE pattern_key = ?").get("phrase-utilize") as any;
  assert.equal(row.positive_count, 2);
  assert.equal(row.negative_count, 1);
  assert.equal(row.category, "formalism");
  const j = await (await call("/api/knowledge", undefined, env)).json() as any;
  assert.deepEqual(j.patterns, [{ pattern_key: "phrase-utilize", category: "formalism", positive_count: 2, negative_count: 1 }]);
});

test("feedback: every rule id the engine can report is accepted (no drift between engine and Worker)", async () => {
  const { db } = makeDb();
  for (const id of RULE_IDS) assert.equal((await post({ patternKey: id, helpful: true }, { DB: db, ASSETS: assets })).status, 200, id);
});

test("privacy: feedback endpoint rejects anything that could carry text", async () => {
  const { db, sql } = makeDb();
  const env = { DB: db, ASSETS: assets };
  const sentence = "My salary is 50000 and my address is 12 Rizal St.";
  const bad: unknown[] = [
    { patternKey: "phrase-utilize", helpful: true, text: sentence },
    { patternKey: "phrase-utilize", helpful: true, note: "hi" },
    { patternKey: sentence, helpful: true },
    { patternKey: "unknown-rule", helpful: true },
    { patternKey: "phrase-utilize", helpful: "yes" },
    { patternKey: "phrase-utilize" },
    [{ patternKey: "phrase-utilize", helpful: true }],
    "not json", "null", "42"
  ];
  for (const b of bad) assert.equal((await post(b, env)).status, 400, JSON.stringify(b));
  assert.equal((await post({ patternKey: "phrase-utilize", helpful: true, pad: "x".repeat(600) }, env)).status, 413);
  assert.equal((sql.prepare("SELECT COUNT(*) AS n FROM pattern_stats").get() as any).n, 0);
  // The schema itself has no column that could hold prose.
  const cols = [...(sql.prepare("PRAGMA table_info(pattern_stats)").all() as any[]), ...(sql.prepare("PRAGMA table_info(knowledge_meta)").all() as any[])].map(c => c.name);
  assert.deepEqual(cols.sort(), ["category", "key", "negative_count", "pattern_key", "positive_count", "updated_at", "updated_at", "value"].sort());
});

test("feedback: 503 (not a crash) when D1 is unavailable, and no text endpoint exists", async () => {
  assert.equal((await post({ patternKey: "phrase-utilize", helpful: true }, { ASSETS: assets })).status, 503);
  const broken = { prepare() { throw new Error("down"); } };
  assert.equal((await post({ patternKey: "phrase-utilize", helpful: true }, { DB: broken, ASSETS: assets })).status, 503);
  for (const path of ["/api/transform", "/api/process", "/api/text", "/api/analyze"]) {
    assert.equal((await call(path, { method: "POST", body: "some text" }, { ASSETS: assets })).status, 404, path);
  }
  assert.equal((await call("/api/feedback", { method: "GET" }, { ASSETS: assets })).status, 404);
});

test("non-API paths are served by the asset binding", async () => {
  const r = await call("/", undefined, { ASSETS: assets });
  assert.equal(await r.text(), "asset");
});
