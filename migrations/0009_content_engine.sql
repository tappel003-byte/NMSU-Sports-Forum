-- Topic list view counts (like Aggie Alert).
ALTER TABLE threads ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

-- Aggie News Desk: each news story becomes at most one topic.
CREATE TABLE news_items (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  thread_id INTEGER REFERENCES threads(id),
  created_at INTEGER NOT NULL
);

-- Automatic topics (conversation starters, recurring weekly topics): one row per posted topic, for de-duplication.
CREATE TABLE auto_topics (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  thread_id INTEGER REFERENCES threads(id),
  created_at INTEGER NOT NULL
);
