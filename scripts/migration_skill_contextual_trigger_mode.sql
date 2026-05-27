-- ============================================================
-- IntelliDraw Skills System - Contextual Trigger Mode
-- Run this in Supabase before deploying UI/API code that sends
-- trigger_mode = 'contextual'.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'skill_note_attachments_trigger_mode_check'
  ) THEN
    ALTER TABLE skill_note_attachments
      DROP CONSTRAINT skill_note_attachments_trigger_mode_check;
  END IF;

  ALTER TABLE skill_note_attachments
    ADD CONSTRAINT skill_note_attachments_trigger_mode_check
    CHECK (trigger_mode IN ('automatic', 'manual', 'contextual'));
END $$;

