-- Game chats a member started for sports without automatic chats (football and men's basketball open automatically).
CREATE TABLE started_chats (
  game_id INTEGER PRIMARY KEY REFERENCES games(id),
  started_by INTEGER REFERENCES users(id),
  started_at INTEGER NOT NULL
);
