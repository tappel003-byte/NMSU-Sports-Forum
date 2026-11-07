-- Aggie Vault: its own page of embedded YouTube clips (classic games, upsets, teams). Never archived.
-- Uses the 'history' section type (allowed by the forums table); the site recognizes it by its slug, 'aggie-vault'.
INSERT INTO forums (slug, name, sport_label, description, icon, sports, kind, archive_exempt, sort)
VALUES ('aggie-vault', 'Aggie Vault', 'Classic clips', 'Great Aggie moments on video. Never archived.', '🎬', '', 'history', 1, 85);
