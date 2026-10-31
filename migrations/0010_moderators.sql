-- Moderators: members who can moderate discussions (flags, removals, suspensions, ban votes, appeals) but not run the site.
-- Kept as a flag so the existing role rule ('member' | 'admin') stays untouched.
ALTER TABLE users ADD COLUMN moderator INTEGER NOT NULL DEFAULT 0;
