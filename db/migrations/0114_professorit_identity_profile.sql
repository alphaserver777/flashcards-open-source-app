-- Keeps the display name supplied by Professor IT LMS separate from email and
-- preserves every learner's own workspace and repetition schedule.
ALTER TABLE org.user_settings
  ADD COLUMN IF NOT EXISTS display_name TEXT;

