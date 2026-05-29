-- Deprecated star cache cleanup.
-- The marketplace bolt now uses live active_usage_count from attachments/installations.

ALTER TABLE skill_notes
  DROP COLUMN IF EXISTS stars;
