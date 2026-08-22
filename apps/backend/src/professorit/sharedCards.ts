import { canManageProfessorItSharedContent } from "../auth/professoritPermissions";
import { updateCardInExecutor } from "../cards";
import type { DatabaseExecutor } from "../database";

type SharedCardCopyRow = Readonly<{
  shared_card_id: string;
  card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  last_modified_by_replica_id: string;
  shared_front_text: string;
  shared_back_text: string;
  shared_card_type: string;
  shared_updated_at: Date | string;
  shared_updated_at_applied: Date | string;
}>;

function professorITSharedCardsEnabled(): boolean {
  return process.env.AUTH_MODE?.trim().toLowerCase() === "professorit";
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function registerProfessorITSharedCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<void> {
  if (professorITSharedCardsEnabled() === false) return;

  await executor.query(
    [
      "WITH latest_cards AS (",
      "SELECT DISTINCT ON (versions.package_id, cards.stable_card_key)",
      "versions.package_id, cards.stable_card_key, cards.front_text, cards.back_text, cards.card_type, cards.created_at, cards.updated_at",
      "FROM catalog.authors AS authors",
      "INNER JOIN catalog.packages AS packages ON packages.author_id = authors.author_id",
      "INNER JOIN catalog.package_versions AS versions ON versions.package_id = packages.package_id",
      "INNER JOIN catalog.package_cards AS cards ON cards.package_version_id = versions.package_version_id",
      "WHERE authors.slug = 'professor-it' AND versions.status = 'published'",
      "ORDER BY versions.package_id, cards.stable_card_key, versions.version_number DESC",
      ")",
      "INSERT INTO content.professorit_shared_cards (package_id, stable_card_key, front_text, back_text, card_type, created_at, updated_at)",
      "SELECT package_id, stable_card_key, front_text, back_text, card_type, created_at, updated_at FROM latest_cards",
      "ON CONFLICT (package_id, stable_card_key) DO NOTHING",
    ].join(" "),
    [],
  );

  await executor.query(
    [
      "INSERT INTO content.professorit_shared_card_copies (shared_card_id, workspace_id, card_id, shared_updated_at_applied)",
      "SELECT shared_cards.shared_card_id, installs.workspace_id, (installed_card.value->>'cardId')::uuid, shared_cards.updated_at",
      "FROM sync.catalog_package_install_idempotency AS installs",
      "CROSS JOIN LATERAL jsonb_array_elements(installs.install_result->'installedCards') AS installed_card(value)",
      "INNER JOIN catalog.package_versions AS versions ON versions.package_version_id = installs.package_version_id",
      "INNER JOIN content.professorit_shared_cards AS shared_cards ON shared_cards.package_id = versions.package_id",
      "AND shared_cards.stable_card_key = installed_card.value->>'stableCardKey'",
      "INNER JOIN content.cards AS cards ON cards.workspace_id = installs.workspace_id",
      "AND cards.card_id = (installed_card.value->>'cardId')::uuid",
      "WHERE installs.workspace_id = $1",
      "ON CONFLICT DO NOTHING",
    ].join(" "),
    [workspaceId],
  );
}

export async function synchronizeProfessorITSharedCardsInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  if (professorITSharedCardsEnabled() === false) return;
  await registerProfessorITSharedCardsInExecutor(executor, workspaceId);

  const result = await executor.query<SharedCardCopyRow>(
    [
      "SELECT shared_cards.shared_card_id, cards.card_id, cards.front_text, cards.back_text, cards.card_type,",
      "cards.last_modified_by_replica_id, copies.shared_updated_at_applied,",
      "shared_cards.front_text AS shared_front_text, shared_cards.back_text AS shared_back_text,",
      "shared_cards.card_type AS shared_card_type, shared_cards.updated_at AS shared_updated_at",
      "FROM content.professorit_shared_card_copies AS copies",
      "INNER JOIN content.professorit_shared_cards AS shared_cards ON shared_cards.shared_card_id = copies.shared_card_id",
      "INNER JOIN content.cards AS cards ON cards.workspace_id = copies.workspace_id AND cards.card_id = copies.card_id",
      "WHERE copies.workspace_id = $1 AND cards.deleted_at IS NULL",
    ].join(" "),
    [workspaceId],
  );

  if (canManageProfessorItSharedContent(userId)) {
    for (const row of result.rows) {
      const contentChanged = row.front_text !== row.shared_front_text
        || row.back_text !== row.shared_back_text
        || row.card_type !== row.shared_card_type;
      if (contentChanged === false) {
        if (new Date(row.shared_updated_at_applied).getTime() < new Date(row.shared_updated_at).getTime()) {
          await executor.query(
            "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
            [row.shared_card_id, workspaceId, row.shared_updated_at],
          );
        }
        continue;
      }
      if (new Date(row.shared_updated_at_applied).getTime() >= new Date(row.shared_updated_at).getTime()) {
        const updatedSharedCard = await executor.query<Readonly<{ updated_at: Date | string }>>(
          "UPDATE content.professorit_shared_cards SET front_text = $2, back_text = $3, card_type = $4, updated_at = now() WHERE shared_card_id = $1 RETURNING updated_at",
          [row.shared_card_id, row.front_text, row.back_text, row.card_type],
        );
        const updatedAt = updatedSharedCard.rows[0]?.updated_at;
        if (updatedAt === undefined) throw new Error("Shared card update did not return a row");
        await executor.query(
          "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
          [row.shared_card_id, workspaceId, updatedAt],
        );
        continue;
      }
      const sharedUpdatedAt = toIsoString(row.shared_updated_at);
      await updateCardInExecutor(
        executor,
        workspaceId,
        row.card_id,
        {
          frontText: row.shared_front_text,
          backText: row.shared_back_text,
          cardType: row.shared_card_type,
        },
        {
          clientUpdatedAt: sharedUpdatedAt,
          lastModifiedByReplicaId: row.last_modified_by_replica_id,
          lastOperationId: `professorit-shared-${row.shared_card_id}-${sharedUpdatedAt}`,
        },
      );
      await executor.query(
        "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
        [row.shared_card_id, workspaceId, row.shared_updated_at],
      );
    }
    return;
  }

  for (const row of result.rows) {
    const contentMatches = (
      row.front_text === row.shared_front_text
      && row.back_text === row.shared_back_text
      && row.card_type === row.shared_card_type
    );
    if (contentMatches) {
      if (new Date(row.shared_updated_at_applied).getTime() < new Date(row.shared_updated_at).getTime()) {
        await executor.query(
          "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
          [row.shared_card_id, workspaceId, row.shared_updated_at],
        );
      }
      continue;
    }
    const sharedUpdatedAt = toIsoString(row.shared_updated_at);
    await updateCardInExecutor(
      executor,
      workspaceId,
      row.card_id,
      {
        frontText: row.shared_front_text,
        backText: row.shared_back_text,
        cardType: row.shared_card_type,
      },
      {
        clientUpdatedAt: sharedUpdatedAt,
        lastModifiedByReplicaId: row.last_modified_by_replica_id,
        lastOperationId: `professorit-shared-${row.shared_card_id}-${sharedUpdatedAt}`,
      },
    );
    await executor.query(
      "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
      [row.shared_card_id, workspaceId, row.shared_updated_at],
    );
  }
}
