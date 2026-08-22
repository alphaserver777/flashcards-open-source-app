-- Migration status: Current / additive.
-- Introduces: canonical Professor IT card content with workspace copy links.

CREATE TABLE IF NOT EXISTS content.professorit_shared_cards (
  shared_card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES catalog.packages(package_id) ON DELETE CASCADE,
  stable_card_key TEXT NOT NULL,
  front_text TEXT NOT NULL CHECK (btrim(front_text) <> ''),
  back_text TEXT NOT NULL CHECK (btrim(back_text) <> ''),
  card_type TEXT NOT NULL CHECK (btrim(card_type) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, stable_card_key)
);

CREATE TABLE IF NOT EXISTS content.professorit_shared_card_copies (
  shared_card_id UUID NOT NULL REFERENCES content.professorit_shared_cards(shared_card_id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES content.cards(card_id) ON DELETE CASCADE,
  shared_updated_at_applied TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shared_card_id, workspace_id),
  UNIQUE (workspace_id, card_id)
);

ALTER TABLE content.professorit_shared_card_copies
  ADD COLUMN IF NOT EXISTS shared_updated_at_applied TIMESTAMPTZ;

UPDATE content.professorit_shared_card_copies AS copies
SET shared_updated_at_applied = shared_cards.updated_at
FROM content.professorit_shared_cards AS shared_cards
WHERE shared_cards.shared_card_id = copies.shared_card_id
  AND copies.shared_updated_at_applied IS NULL;

ALTER TABLE content.professorit_shared_card_copies
  ALTER COLUMN shared_updated_at_applied SET NOT NULL;

WITH latest_cards AS (
  SELECT DISTINCT ON (versions.package_id, cards.stable_card_key)
    versions.package_id,
    cards.stable_card_key,
    cards.front_text,
    cards.back_text,
    cards.card_type,
    cards.created_at,
    cards.updated_at
  FROM catalog.authors AS authors
  INNER JOIN catalog.packages AS packages ON packages.author_id = authors.author_id
  INNER JOIN catalog.package_versions AS versions ON versions.package_id = packages.package_id
  INNER JOIN catalog.package_cards AS cards ON cards.package_version_id = versions.package_version_id
  WHERE authors.slug = 'professor-it'
    AND versions.status = 'published'
  ORDER BY versions.package_id, cards.stable_card_key, versions.version_number DESC
)
INSERT INTO content.professorit_shared_cards (
  package_id,
  stable_card_key,
  front_text,
  back_text,
  card_type,
  created_at,
  updated_at
)
SELECT package_id, stable_card_key, front_text, back_text, card_type, created_at, updated_at
FROM latest_cards
ON CONFLICT (package_id, stable_card_key) DO NOTHING;

INSERT INTO content.professorit_shared_card_copies (shared_card_id, workspace_id, card_id, shared_updated_at_applied)
SELECT
  shared_cards.shared_card_id,
  installs.workspace_id,
  (installed_card.value->>'cardId')::uuid,
  shared_cards.updated_at
FROM sync.catalog_package_install_idempotency AS installs
CROSS JOIN LATERAL jsonb_array_elements(installs.install_result->'installedCards') AS installed_card(value)
INNER JOIN catalog.package_versions AS versions ON versions.package_version_id = installs.package_version_id
INNER JOIN content.professorit_shared_cards AS shared_cards
  ON shared_cards.package_id = versions.package_id
  AND shared_cards.stable_card_key = installed_card.value->>'stableCardKey'
INNER JOIN content.cards AS cards
  ON cards.workspace_id = installs.workspace_id
  AND cards.card_id = (installed_card.value->>'cardId')::uuid
ON CONFLICT DO NOTHING;

WITH latest_accepted AS (
  SELECT DISTINCT ON (copies.shared_card_id)
    copies.shared_card_id,
    suggestions.message,
    suggestions.updated_at
  FROM content.professorit_card_suggestions AS suggestions
  INNER JOIN content.professorit_shared_card_copies AS copies
    ON copies.workspace_id = suggestions.workspace_id
    AND copies.card_id = suggestions.card_id
  WHERE suggestions.status = 'accepted'
  ORDER BY copies.shared_card_id, suggestions.updated_at DESC
)
UPDATE content.professorit_shared_cards AS shared_cards
SET back_text = latest_accepted.message, updated_at = now()
FROM latest_accepted
WHERE shared_cards.shared_card_id = latest_accepted.shared_card_id
  AND shared_cards.updated_at <= latest_accepted.updated_at;

CREATE INDEX IF NOT EXISTS idx_professorit_shared_card_copies_workspace
  ON content.professorit_shared_card_copies(workspace_id, card_id);

GRANT SELECT, INSERT, UPDATE ON TABLE content.professorit_shared_cards TO backend_app;
GRANT SELECT, INSERT, UPDATE ON TABLE content.professorit_shared_card_copies TO backend_app;

COMMENT ON TABLE content.professorit_shared_cards IS
  'Canonical Professor IT card content shared by all learner workspaces.';
COMMENT ON TABLE content.professorit_shared_card_copies IS
  'Links canonical Professor IT cards to per-learner scheduling records.';
