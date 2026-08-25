#!/usr/bin/env bash
set -euo pipefail

database_container="${PROFESSORIT_DATABASE_CONTAINER:-flashcards-postgres-1}"
database_name="${PROFESSORIT_DATABASE_NAME:-flashcards}"
export_directory="${PROFESSORIT_CARD_EXPORT_DIRECTORY:-/opt/flashcards/backups/card-exports}"
retention_days="${PROFESSORIT_CARD_EXPORT_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

install -d -m 0700 "$export_directory"

docker exec -i "$database_container" sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -At' sh "$database_name" \
  > "$export_directory/cards-$timestamp.json" <<'SQL'
SELECT coalesce(
  jsonb_pretty(jsonb_agg(to_jsonb(export_row) ORDER BY export_row.subject_slug, export_row.topic_slug, export_row.front_text)),
  '[]'::text
)
FROM (
  SELECT shared_card_id, stable_card_key, front_text, back_text, subject_slug, topic_slug,
         difficulty, question_type, lms_lesson_id, lms_lesson_title, publication_status,
         interview_source, created_at, updated_at
  FROM content.professorit_shared_cards
) AS export_row;
SQL

docker exec -i "$database_container" sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -At' sh "$database_name" \
  > "$export_directory/cards-$timestamp.md" <<'SQL'
SELECT string_agg(
  '## ' || front_text || E'\n\n' ||
  '- Направление: ' || subject_slug || E'\n' ||
  '- Тема: ' || topic_slug || E'\n' ||
  '- Уровень: ' || difficulty || E'\n' ||
  '- Тип: ' || question_type || E'\n' ||
  '- Состояние: ' || publication_status || E'\n' ||
  CASE
    WHEN lms_lesson_id IS NULL THEN ''
    ELSE '- Урок LMS: ' || coalesce(lms_lesson_title, lms_lesson_id) || ' (' || lms_lesson_id || E')\n'
  END || E'\n' || back_text,
  E'\n\n---\n\n' ORDER BY subject_slug, topic_slug, front_text
)
FROM content.professorit_shared_cards;
SQL

find "$export_directory" -maxdepth 1 -type f \
  \( -name 'cards-*.json' -o -name 'cards-*.md' -o -name 'cards-*.sha256' \) \
  -mtime "+$retention_days" -delete

sha256sum "$export_directory/cards-$timestamp.json" "$export_directory/cards-$timestamp.md" \
  > "$export_directory/cards-$timestamp.sha256"
