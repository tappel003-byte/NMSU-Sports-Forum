-- Streaming audio/video links published in the official calendar feed ("Listen live" / "Watch").
ALTER TABLE games ADD COLUMN audio_url TEXT;
ALTER TABLE games ADD COLUMN video_url TEXT;
