-- Migration status: Current / additive.
-- Introduces: immutable card and student labels for Professor IT suggestions.
-- Schemas touched/read explicitly: content, org.

ALTER TABLE content.professorit_card_suggestions
  ADD COLUMN IF NOT EXISTS front_text TEXT,
  ADD COLUMN IF NOT EXISTS submitter_display_name TEXT,
  ADD COLUMN IF NOT EXISTS submitter_email TEXT;

UPDATE content.professorit_card_suggestions AS suggestions
SET
  front_text = (
    SELECT cards.front_text
    FROM content.cards AS cards
    WHERE cards.card_id = suggestions.card_id
  ),
  submitter_display_name = (
    SELECT settings.display_name
    FROM org.user_settings AS settings
    WHERE settings.user_id = suggestions.user_id
  ),
  submitter_email = (
    SELECT settings.email
    FROM org.user_settings AS settings
    WHERE settings.user_id = suggestions.user_id
  )
WHERE suggestions.front_text IS NULL;

ALTER TABLE content.professorit_card_suggestions
  ALTER COLUMN front_text SET NOT NULL;

COMMENT ON COLUMN content.professorit_card_suggestions.front_text IS
  'Card front captured when a learner submits the suggestion, so author review never needs cross-workspace card access.';
