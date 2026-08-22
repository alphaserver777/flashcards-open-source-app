-- Migration status: Current / additive.
-- Introduces: moderated Professor IT card suggestions.
-- Schemas touched/read explicitly: content, org.

CREATE TABLE IF NOT EXISTS content.professorit_card_suggestions (
  suggestion_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES content.cards(card_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('improvement', 'error')),
  message TEXT NOT NULL CHECK (btrim(message) <> '' AND length(message) <= 5000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  author_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_professorit_card_suggestions_status_created
  ON content.professorit_card_suggestions(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON TABLE content.professorit_card_suggestions TO backend_app;

COMMENT ON TABLE content.professorit_card_suggestions IS 'Student proposals are moderated separately and never mutate shared cards directly.';
