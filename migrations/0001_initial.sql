-- Lexora stores aggregate linguistic pattern statistics only.
-- Never add raw input, output, uploaded documents, or personal identifiers here.
CREATE TABLE IF NOT EXISTS pattern_stats (
  pattern_key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO knowledge_meta (key, value) VALUES
  ('schema_version', '1'),
  ('knowledge_description', 'Aggregated pattern feedback only; no user text is stored.');
