-- The post a reply answers ("↩ Replying to …"), separate from quoting its text.
ALTER TABLE posts ADD COLUMN reply_to_post_id INTEGER;
