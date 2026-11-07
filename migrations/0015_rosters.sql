-- Past and present rosters for every sport, by Time Machine season (season = fall start year; 1992 means 1992–93).
-- Filled automatically (football from CollegeFootballData, basketball from Wikipedia) and by members (media guides etc.).
-- Imports only ever add rows; once a member fixes a row, imports never overwrite it.
CREATE TABLE roster_players (
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
  source TEXT NOT NULL CHECK (source IN ('cfbd', 'wikipedia', 'member')),
  source_key TEXT UNIQUE,
  source_url TEXT,
  added_by INTEGER,
  updated_by INTEGER,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_roster_season ON roster_players(sport, season, removed);
