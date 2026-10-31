-- Site owner: cannot be demoted, suspended, warned, banned or have a reset link made by anyone else.
-- The owner is the forum's first admin account.
ALTER TABLE users ADD COLUMN owner INTEGER NOT NULL DEFAULT 0;
UPDATE users SET owner = 1 WHERE id = (SELECT MIN(id) FROM users WHERE role = 'admin');
