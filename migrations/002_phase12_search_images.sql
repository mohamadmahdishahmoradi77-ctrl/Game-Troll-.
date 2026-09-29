-- GAME TROLL Phase 12: advanced search/filter and image management
CREATE INDEX IF NOT EXISTS idx_games_advanced ON games(status,console,platform,genre,year,pack,created_at);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at,owner_id);
