-- Media guide photos members send in for a season's roster. Private to admins; an admin enters the players
-- (or pastes a list) and marks the photo done, which notifies the sender and deletes the image.
CREATE TABLE roster_photos (
  id INTEGER PRIMARY KEY,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  image_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_by INTEGER,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_roster_photos_status ON roster_photos(status, created_at);
