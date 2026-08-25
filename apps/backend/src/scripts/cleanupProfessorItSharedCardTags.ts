import { transactionWithWorkspaceScope } from "../database";
import { unsafeTransaction } from "../database/core";
import { updateCardInExecutor } from "../cards";

type WorkspaceMemberRow = Readonly<{
  workspace_id: string;
  user_id: string;
}>;

type TaggedSharedCardRow = Readonly<{
  card_id: string;
}>;

async function loadTargetWorkspaces(): Promise<ReadonlyArray<WorkspaceMemberRow>> {
  const configuredWorkspaceId = process.env.PROFESSORIT_CLEANUP_WORKSPACE_ID?.trim();
  const configuredUserId = process.env.PROFESSORIT_CLEANUP_USER_ID?.trim();
  if (configuredWorkspaceId !== undefined || configuredUserId !== undefined) {
    if (configuredWorkspaceId === undefined || configuredUserId === undefined) {
      throw new Error(
        "PROFESSORIT_CLEANUP_WORKSPACE_ID and PROFESSORIT_CLEANUP_USER_ID must be set together.",
      );
    }
    return [{ workspace_id: configuredWorkspaceId, user_id: configuredUserId }];
  }

  return unsafeTransaction(async (executor) => {
    const result = await executor.query<WorkspaceMemberRow>(
      [
        "SELECT DISTINCT ON (copies.workspace_id) copies.workspace_id, memberships.user_id",
        "FROM content.professorit_shared_card_copies AS copies",
        "INNER JOIN org.workspace_memberships AS memberships ON memberships.workspace_id = copies.workspace_id",
        "ORDER BY copies.workspace_id, CASE WHEN memberships.role = 'owner' THEN 0 ELSE 1 END, memberships.created_at ASC",
      ].join(" "),
      [],
    );
    return result.rows;
  });
}

async function cleanupWorkspace(row: WorkspaceMemberRow): Promise<number> {
  return transactionWithWorkspaceScope(
    { userId: row.user_id, workspaceId: row.workspace_id },
    async (executor) => {
      const taggedCards = await executor.query<TaggedSharedCardRow>(
        [
          "SELECT cards.card_id",
          "FROM content.cards AS cards",
          "INNER JOIN content.professorit_shared_card_copies AS copies",
          "ON copies.workspace_id = cards.workspace_id AND copies.card_id = cards.card_id",
          "WHERE cards.workspace_id = $1 AND cardinality(cards.tags) > 0",
          "ORDER BY cards.card_id",
        ].join(" "),
        [row.workspace_id],
      );

      const updatedAt = new Date().toISOString();
      for (const card of taggedCards.rows) {
        await updateCardInExecutor(
          executor,
          row.workspace_id,
          card.card_id,
          { tags: [] },
          {
            clientUpdatedAt: updatedAt,
            lastModifiedByReplicaId: "professorit-shared-tag-cleanup",
            lastOperationId: `professorit-shared-tag-cleanup-${card.card_id}`,
          },
        );
      }
      return taggedCards.rows.length;
    },
  );
}

async function main(): Promise<void> {
  const workspaces = await loadTargetWorkspaces();
  let cleanedCards = 0;
  for (const workspace of workspaces) {
    cleanedCards += await cleanupWorkspace(workspace);
  }
  console.log(JSON.stringify({ workspaces: workspaces.length, cleanedCards }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
