-- Allow 'espn' as a roster source (this season's rosters for football, basketball and baseball).
CREATE TABLE roster_players_new (
  id INTEGER PRIMARY KEY,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  jersey TEXT,
  position TEXT,
  class_year TEXT,
  height TEXT,
  weight INTEGER,
  hometown TEXT,
  source TEXT NOT NULL CHECK (source IN ('cfbd', 'wikipedia', 'member', 'espn')),
  source_key TEXT UNIQUE,
  source_url TEXT,
  added_by INTEGER,
  updated_by INTEGER,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO roster_players_new SELECT * FROM roster_players;
DROP TABLE roster_players;
ALTER TABLE roster_players_new RENAME TO roster_players;
CREATE INDEX idx_roster_season ON roster_players(sport, season, removed);
