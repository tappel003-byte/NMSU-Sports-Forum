-- Round two: thread tags, first-post approval, timed suspensions, account deletion,
-- member-nominated poll options, push notifications, link previews, recruiting tracker.

ALTER TABLE threads ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE threads ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_until INTEGER;
ALTER TABLE users ADD COLUMN trusted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE polls ADD COLUMN allow_add INTEGER NOT NULL DEFAULT 0;
ALTER TABLE polls ADD COLUMN kind TEXT;
ALTER TABLE poll_options ADD COLUMN added_by INTEGER;

-- Everyone who joined before this migration is already trusted.
UPDATE users SET trusted = 1;

CREATE INDEX idx_posts_pending ON posts(pending) WHERE pending = 1;

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

CREATE TABLE link_previews (
  url TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  site TEXT,
  author TEXT,
  author_url TEXT,
  published TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  sport TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recruit', 'transfer_in', 'transfer_out')),
  source TEXT NOT NULL CHECK (source IN ('cfbd', 'member')),
  source_key TEXT UNIQUE,
  name TEXT NOT NULL,
  position TEXT,
  class_year INTEGER,
  school TEXT,
  hometown TEXT,
  stars INTEGER,
  rating REAL,
  ranking INTEGER,
  status TEXT NOT NULL DEFAULT 'tracking',
  other_school TEXT,
  source_url TEXT,
  thread_id INTEGER,
  created_by INTEGER,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_players_list ON players(removed, sport, kind, class_year);

CREATE TABLE player_news (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  user_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  post_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_player_news ON player_news(player_id, id DESC);

CREATE TABLE player_predictions (
  player_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  pick TEXT NOT NULL CHECK (pick IN ('yes', 'no')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, user_id)
);

INSERT INTO settings (key, value) VALUES ('approve_first_post', '0');

CREATE TABLE data_sync (
  key TEXT PRIMARY KEY,
  last_ok_at INTEGER,
  last_error TEXT,
  last_error_at INTEGER,
  last_counts TEXT
);
