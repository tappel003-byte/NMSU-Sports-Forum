-- Photo from a shared tweet (X embed data): shown with the tweet, and the first one becomes the player's card photo.
ALTER TABLE link_previews ADD COLUMN image TEXT;
ALTER TABLE players ADD COLUMN photo_url TEXT;
