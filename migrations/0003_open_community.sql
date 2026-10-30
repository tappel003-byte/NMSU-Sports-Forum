-- Open community: sign-up mode, public reading, email confirmation, troll flags.
ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'report';
ALTER TABLE users ADD COLUMN joined_open INTEGER NOT NULL DEFAULT 0;

CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_troll_flags ON reports(post_id, reporter_id) WHERE kind = 'troll';

INSERT INTO settings (key, value) VALUES ('signup_mode', 'invite'), ('public_read', '0'), ('troll_threshold', '3');
