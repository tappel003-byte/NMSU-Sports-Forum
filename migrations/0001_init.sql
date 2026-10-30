-- NMSU Sports Forum initial schema. All timestamps are Unix epoch milliseconds.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  display_name TEXT,
  bio TEXT,
  avatar_key TEXT,
  grad_year INTEGER,
  city TEXT,
  state TEXT,
  interests TEXT,
  legacy_moniker TEXT,
  legacy_join_year INTEGER,
  legacy_post_count INTEGER,
  show_email INTEGER NOT NULL DEFAULT 0,
  show_on_map INTEGER NOT NULL DEFAULT 0,
  map_lat REAL,
  map_lon REAL,
  birthday_md TEXT,
  show_birthday INTEGER NOT NULL DEFAULT 0,
  featured_post_id INTEGER,
  prefs TEXT NOT NULL DEFAULT '{}',
  marked_read_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  email TEXT,
  note TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE invite_uses (
  invite_id INTEGER NOT NULL REFERENCES invites(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  used_at INTEGER NOT NULL
);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(key, at);

CREATE TABLE forums (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sport_label TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  sports TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'sport' CHECK (kind IN ('sport', 'general', 'history', 'suggestions')),
  archive_exempt INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE threads (
  id INTEGER PRIMARY KEY,
  forum_id INTEGER NOT NULL REFERENCES forums(id),
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sport TEXT,
  created_at INTEGER NOT NULL,
  last_post_at INTEGER NOT NULL,
  last_post_id INTEGER NOT NULL DEFAULT 0,
  last_post_user_id INTEGER,
  reply_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  reopened_at INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  game_id INTEGER,
  game_phase TEXT CHECK (game_phase IN ('pregame', 'postgame') OR game_phase IS NULL),
  suggestion_status TEXT CHECK (suggestion_status IN ('under_consideration', 'planned', 'implemented', 'declined') OR suggestion_status IS NULL)
);
CREATE INDEX idx_threads_forum ON threads(forum_id, deleted, pinned DESC, last_post_at DESC);
CREATE INDEX idx_threads_last ON threads(deleted, last_post_at DESC);
CREATE INDEX idx_threads_game ON threads(game_id);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  quote_post_id INTEGER,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  edit_count INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by INTEGER
);
CREATE INDEX idx_posts_thread ON posts(thread_id, id);
CREATE INDEX idx_posts_user ON posts(user_id, deleted);

CREATE TABLE post_edits (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  editor_id INTEGER NOT NULL,
  old_body TEXT NOT NULL,
  edited_at INTEGER NOT NULL
);

CREATE TABLE reactions (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  value INTEGER NOT NULL CHECK (value IN (1, -1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_reactions_created ON reactions(created_at);

CREATE TABLE thread_reads (
  user_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  last_read_post_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE follows (
  user_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX idx_follows_thread ON follows(thread_id);

CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  note TEXT,
  remind_at INTEGER,
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, post_id)
);
CREATE INDEX idx_bookmarks_remind ON bookmarks(reminded, remind_at);

CREATE TABLE drafts (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE polls (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL UNIQUE REFERENCES threads(id),
  question TEXT NOT NULL,
  closes_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id),
  label TEXT NOT NULL,
  sort INTEGER NOT NULL
);
CREATE TABLE poll_votes (
  poll_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  post_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'avatar')),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_attachments_post ON attachments(post_id);
CREATE INDEX idx_attachments_expiry ON attachments(deleted, expires_at);

-- Fallback image storage used only when no R2 bucket is bound.
CREATE TABLE blobs (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_id INTEGER,
  text TEXT NOT NULL,
  link TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, id DESC);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL,
  post_id INTEGER,
  dm_message_id INTEGER,
  chat_message_id INTEGER,
  snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by INTEGER,
  resolution_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE mutes (
  user_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'forum')),
  target_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE dm_conversations (
  id INTEGER PRIMARY KEY,
  user_a INTEGER NOT NULL,
  user_b INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);
CREATE TABLE dm_messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id),
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_dm_messages_conv ON dm_messages(conversation_id, id);
CREATE TABLE dm_reads (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_id INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE badges (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  badge TEXT NOT NULL,
  reason TEXT NOT NULL,
  awarded_by INTEGER,
  awarded_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_badges_user ON badges(user_id);

CREATE TABLE mod_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE data_feeds (
  id INTEGER PRIMARY KEY,
  sport TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_ok_at INTEGER,
  last_error TEXT,
  last_error_at INTEGER,
  last_counts TEXT,
  failing INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  feed_id INTEGER,
  source_uid TEXT NOT NULL UNIQUE,
  sport TEXT NOT NULL,
  opponent TEXT NOT NULL,
  home_away TEXT NOT NULL DEFAULT 'tbd' CHECK (home_away IN ('home', 'away', 'neutral', 'tbd')),
  venue TEXT,
  starts_at INTEGER NOT NULL,
  time_tba INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'final', 'postponed', 'canceled')),
  result TEXT CHECK (result IN ('W', 'L', 'T') OR result IS NULL),
  nmsu_score INTEGER,
  opp_score INTEGER,
  tv TEXT,
  radio TEXT,
  official_url TEXT,
  tickets_url TEXT,
  stats_url TEXT,
  raw_summary TEXT,
  override_fields TEXT NOT NULL DEFAULT '{}',
  removed INTEGER NOT NULL DEFAULT 0,
  pregame_thread_id INTEGER,
  postgame_thread_id INTEGER,
  predictions_scored INTEGER NOT NULL DEFAULT 0,
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_games_start ON games(removed, starts_at);
CREATE INDEX idx_games_sport ON games(sport, starts_at);

CREATE TABLE predictions (
  game_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  pick TEXT NOT NULL CHECK (pick IN ('nmsu', 'opp')),
  nmsu_score INTEGER,
  opp_score INTEGER,
  points INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY,
  room TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by INTEGER
);
CREATE INDEX idx_chat_room ON chat_messages(room, id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('watch_party', 'gathering', 'meetup', 'other')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  game_id INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_start ON events(deleted, starts_at);
CREATE TABLE event_rsvps (
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe')),
  PRIMARY KEY (event_id, user_id)
);

INSERT INTO forums (slug, name, sport_label, description, icon, sports, kind, archive_exempt, sort) VALUES
  ('the-pan-am', 'The Pan Am', 'Basketball · Volleyball', 'Men''s and women''s basketball and volleyball.', '🏀', 'mbb,wbb,vb', 'sport', 0, 10),
  ('aggie-memorial', 'Aggie Memorial', 'Football', 'Aggie football, from recruiting to Saturday.', '🏈', 'fb', 'sport', 0, 20),
  ('presley-askew-field', 'Presley Askew Field', 'Baseball', 'Aggie baseball.', '⚾', 'base', 'sport', 0, 30),
  ('softball-complex', 'Softball Complex', 'Softball', 'Aggie softball.', '🥎', 'soft', 'sport', 0, 40),
  ('the-pitch', 'The Pitch', 'Women''s Soccer', 'Aggie women''s soccer.', '⚽', 'wsoc', 'sport', 0, 50),
  ('track-and-field', 'Track & Field', 'Track · Cross Country', 'Track and field and cross country.', '🏃', 'track,xc', 'sport', 0, 60),
  ('other-sports', 'Other Sports', 'Golf · Tennis · Swimming · More', 'Every other Aggie sport.', '🏅', 'other', 'sport', 0, 70),
  ('general', 'General Discussion', 'Aggie Talk', 'Anything Aggie that doesn''t fit elsewhere.', '💬', '', 'general', 0, 80),
  ('aggie-history', 'Aggie History', 'Classic Games · Memories', 'Classic games, favorite players and community memories. Never archived.', '📜', '', 'history', 1, 90),
  ('suggestions', 'Suggestions & Improvements', 'Help Build the Forum', 'Propose a feature, discuss it, and see it through to Implemented.', '💡', '', 'suggestions', 0, 100);

INSERT INTO settings (key, value) VALUES
  ('launch_date', ''),
  ('honorary_threshold', '0'),
  ('chat_window', '200'),
  ('announcement', '');
