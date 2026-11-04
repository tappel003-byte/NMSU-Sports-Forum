-- Cached box scores from ESPN's public game summary (one row per game; refreshed each minute while live).
CREATE TABLE box_scores (
  game_id INTEGER PRIMARY KEY REFERENCES games(id),
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
