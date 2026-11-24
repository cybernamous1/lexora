-- Curated, versioned linguistic knowledge. Rows are written by maintainers through migrations only;
-- the public API can never insert into this table, and it never contains user text.
CREATE TABLE IF NOT EXISTS knowledge_shards (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lexicon', 'tuning')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  engine_min INTEGER NOT NULL DEFAULT 1,
  standards TEXT,              -- optional JSON array of writing standards the shard applies to
  payload TEXT NOT NULL,       -- JSON; validated again by the engine before use
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_shards_status ON knowledge_shards (status, id);

INSERT OR REPLACE INTO knowledge_meta (key, value) VALUES ('schema_version', '2');

-- Seed shard: additional wordiness reductions. Draft -> active promotion is a deliberate, reviewed step.
INSERT OR IGNORE INTO knowledge_shards (id, version, kind, status, confidence, engine_min, payload) VALUES
  ('wordiness-extra', 1, 'lexicon', 'active', 0.8, 2, '{"intensity":"balanced","pairs":[
    {"from":"in the midst of","to":"during"},
    {"from":"during the course of","to":"during"},
    {"from":"in close proximity to","to":"near"},
    {"from":"in the vicinity of","to":"near"},
    {"from":"for the most part","to":"mostly"},
    {"from":"at a later date","to":"later"},
    {"from":"has a tendency to","to":"tends to"},
    {"from":"have a tendency to","to":"tend to"},
    {"from":"make an effort to","to":"try to"},
    {"from":"in light of the fact that","to":"because"}
  ]}');
