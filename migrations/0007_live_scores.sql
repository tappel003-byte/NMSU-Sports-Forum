-- Short-lived cache of in-game scores from ESPN's public scoreboard (one row per game), so many viewers share one lookup.
CREATE TABLE live_scores (
  game_id INTEGER PRIMARY KEY REFERENCES games(id),
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
