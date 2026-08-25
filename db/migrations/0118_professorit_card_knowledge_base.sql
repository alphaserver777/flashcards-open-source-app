-- Migration status: Current / additive.
-- Introduces: structured Professor IT interview-card taxonomy, LMS links and revision history.

ALTER TABLE content.professorit_shared_cards
  ADD COLUMN IF NOT EXISTS subject_slug TEXT,
  ADD COLUMN IF NOT EXISTS topic_slug TEXT,
  ADD COLUMN IF NOT EXISTS difficulty TEXT,
  ADD COLUMN IF NOT EXISTS question_type TEXT,
  ADD COLUMN IF NOT EXISTS lms_lesson_id TEXT,
  ADD COLUMN IF NOT EXISTS lms_lesson_title TEXT,
  ADD COLUMN IF NOT EXISTS publication_status TEXT,
  ADD COLUMN IF NOT EXISTS interview_source TEXT;

UPDATE content.professorit_shared_cards AS shared_cards
SET
  subject_slug = COALESCE(shared_cards.subject_slug, CASE
    WHEN lower(packages.slug) LIKE '%git%' THEN 'git'
    WHEN lower(packages.slug) LIKE '%linux%' THEN 'linux'
    ELSE 'other'
  END),
  topic_slug = COALESCE(shared_cards.topic_slug, CASE
    WHEN lower(shared_cards.front_text) ~ '(процесс|pid|fork|zombie|load average|oom|cpu|памят)' THEN 'processes'
    WHEN lower(shared_cards.front_text) ~ '(диск|inode|файлов|mount|lvm|raid|ссылк)' THEN 'storage'
    WHEN lower(shared_cards.front_text) ~ '(сеть|dns|порт|tcp|udp|icmp|маршрут|ssh)' THEN 'network'
    WHEN lower(shared_cards.front_text) ~ '(ветк|merge|rebase|checkout|switch)' THEN 'branches'
    WHEN lower(shared_cards.front_text) ~ '(commit|индекс|staging|working tree)' THEN 'basics'
    ELSE 'fundamentals'
  END),
  difficulty = COALESCE(shared_cards.difficulty, CASE
    WHEN lower(shared_cards.front_text) ~ '(кейс|диагност|почему|сравн|в чем разница|что делать)' THEN 'middle'
    WHEN lower(shared_cards.front_text) ~ '(внутрен|архитект|ядр|как работает.*пошаг)' THEN 'senior'
    ELSE 'junior'
  END),
  question_type = COALESCE(shared_cards.question_type, CASE
    WHEN lower(shared_cards.front_text) ~ '(кейс|что делать|не работает|сломал|ошибк|диагност)' THEN 'case'
    WHEN lower(shared_cards.front_text) ~ '(команд|как посмотреть|как узнать|как создать|как удалить|как настроить)' THEN 'command'
    ELSE 'theory'
  END),
  publication_status = COALESCE(shared_cards.publication_status, 'published')
FROM catalog.packages AS packages
WHERE packages.package_id = shared_cards.package_id;

ALTER TABLE content.professorit_shared_cards
  ALTER COLUMN subject_slug SET DEFAULT 'other',
  ALTER COLUMN subject_slug SET NOT NULL,
  ALTER COLUMN topic_slug SET DEFAULT 'fundamentals',
  ALTER COLUMN topic_slug SET NOT NULL,
  ALTER COLUMN difficulty SET DEFAULT 'junior',
  ALTER COLUMN difficulty SET NOT NULL,
  ALTER COLUMN question_type SET DEFAULT 'theory',
  ALTER COLUMN question_type SET NOT NULL,
  ALTER COLUMN publication_status SET DEFAULT 'published',
  ALTER COLUMN publication_status SET NOT NULL;

ALTER TABLE content.professorit_shared_cards
  DROP CONSTRAINT IF EXISTS professorit_shared_cards_difficulty_check,
  ADD CONSTRAINT professorit_shared_cards_difficulty_check
    CHECK (difficulty IN ('junior', 'middle', 'senior')),
  DROP CONSTRAINT IF EXISTS professorit_shared_cards_question_type_check,
  ADD CONSTRAINT professorit_shared_cards_question_type_check
    CHECK (question_type IN ('theory', 'command', 'case')),
  DROP CONSTRAINT IF EXISTS professorit_shared_cards_publication_status_check,
  ADD CONSTRAINT professorit_shared_cards_publication_status_check
    CHECK (publication_status IN ('draft', 'published', 'archived')),
  DROP CONSTRAINT IF EXISTS professorit_shared_cards_subject_slug_check,
  ADD CONSTRAINT professorit_shared_cards_subject_slug_check
    CHECK (subject_slug ~ '^[a-z0-9][a-z0-9-]*$'),
  DROP CONSTRAINT IF EXISTS professorit_shared_cards_topic_slug_check,
  ADD CONSTRAINT professorit_shared_cards_topic_slug_check
    CHECK (topic_slug ~ '^[a-z0-9][a-z0-9-]*$');

CREATE TABLE IF NOT EXISTS content.professorit_shared_card_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_card_id UUID NOT NULL REFERENCES content.professorit_shared_cards(shared_card_id) ON DELETE CASCADE,
  changed_by_user_id TEXT,
  change_reason TEXT,
  previous_value JSONB NOT NULL,
  current_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION content.record_professorit_shared_card_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO content.professorit_shared_card_history (
    shared_card_id,
    changed_by_user_id,
    change_reason,
    previous_value,
    current_value
  ) VALUES (
    NEW.shared_card_id,
    NULLIF(current_setting('professorit.changed_by_user_id', true), ''),
    NULLIF(current_setting('professorit.change_reason', true), ''),
    to_jsonb(OLD),
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_professorit_shared_card_history ON content.professorit_shared_cards;
CREATE TRIGGER trg_professorit_shared_card_history
AFTER UPDATE ON content.professorit_shared_cards
FOR EACH ROW
WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION content.record_professorit_shared_card_history();

CREATE INDEX IF NOT EXISTS idx_professorit_shared_cards_taxonomy
  ON content.professorit_shared_cards(subject_slug, topic_slug, difficulty, question_type)
  WHERE publication_status = 'published';
CREATE INDEX IF NOT EXISTS idx_professorit_shared_cards_missing_lesson
  ON content.professorit_shared_cards(subject_slug, topic_slug)
  WHERE publication_status = 'published' AND lms_lesson_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_professorit_shared_card_history_card
  ON content.professorit_shared_card_history(shared_card_id, created_at DESC);

GRANT SELECT, INSERT ON TABLE content.professorit_shared_card_history TO backend_app;

COMMENT ON TABLE content.professorit_shared_card_history IS
  'Immutable revision history for canonical Professor IT interview cards.';
