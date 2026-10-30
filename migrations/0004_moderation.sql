-- Moderation v2: warnings, temporary suspensions, three-moderator bans, appeals, flag-abuse controls.
ALTER TABLE users ADD COLUMN banned_at INTEGER;
ALTER TABLE users ADD COLUMN can_flag INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN suspension_reason TEXT;
ALTER TABLE mod_log ADD COLUMN subject_user_id INTEGER;

CREATE TABLE warnings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  post_id INTEGER,
  reason TEXT NOT NULL,
  issued_by INTEGER NOT NULL,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_warnings_user ON warnings(user_id);

CREATE TABLE ban_proposals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  proposed_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'expired')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE ban_votes (
  proposal_id INTEGER NOT NULL REFERENCES ban_proposals(id),
  moderator_id INTEGER NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('approve', 'reject')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, moderator_id)
);

-- An appeal targets one recorded moderation decision (a mod_log entry).
CREATE TABLE appeals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  log_id INTEGER NOT NULL REFERENCES mod_log(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'overturned')),
  decided_by INTEGER,
  decision_note TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  UNIQUE (user_id, log_id)
);

UPDATE settings SET value = '3' WHERE key = 'troll_threshold';
