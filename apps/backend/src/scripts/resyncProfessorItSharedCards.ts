import { updateCardInExecutor } from "../cards";
import { transactionWithWorkspaceScope } from "../database";
import { unsafeTransaction } from "../database/core";
import type { CardMetadata } from "../cards";
import { buildSystemWorkspaceReplicaId } from "../sync/identity/replica";

type WorkspaceMemberRow = Readonly<{
  workspace_id: string;
  user_id: string;
}>;

type SharedCardRow = Readonly<{
  card_id: string;
  metadata: CardMetadata;
}>;

async function loadWorkspaces(): Promise<ReadonlyArray<WorkspaceMemberRow>> {
  const configuredWorkspaceId = process.env.PROFESSORIT_RESYNC_WORKSPACE_ID?.trim();
  const configuredUserId = process.env.PROFESSORIT_RESYNC_USER_ID?.trim();
  if (configuredWorkspaceId !== undefined || configuredUserId !== undefined) {
    if (configuredWorkspaceId === undefined || configuredUserId === undefined) {
      throw new Error(
        "PROFESSORIT_RESYNC_WORKSPACE_ID and PROFESSORIT_RESYNC_USER_ID must be set together.",
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

async function resyncWorkspace(workspace: WorkspaceMemberRow): Promise<number> {
  return transactionWithWorkspaceScope(
    { userId: workspace.user_id, workspaceId: workspace.workspace_id },
    async (executor) => {
      const result = await executor.query<SharedCardRow>(
        [
          "SELECT cards.card_id, cards.metadata",
          "FROM content.cards AS cards",
          "INNER JOIN content.professorit_shared_card_copies AS copies",
          "ON copies.workspace_id = cards.workspace_id AND copies.card_id = cards.card_id",
          "WHERE cards.workspace_id = $1 AND cards.metadata ? 'professorIt'",
          "ORDER BY cards.card_id",
        ].join(" "),
        [workspace.workspace_id],
      );

      const clientUpdatedAt = new Date().toISOString();
      const replicaId = buildSystemWorkspaceReplicaId(
        workspace.workspace_id,
        "workspace_seed",
        "workspace-seed",
      );
      for (const card of result.rows) {
        await updateCardInExecutor(
          executor,
          workspace.workspace_id,
          card.card_id,
          { metadata: card.metadata },
          {
            clientUpdatedAt,
            lastModifiedByReplicaId: replicaId,
            lastOperationId: `professorit-shared-resync-${card.card_id}-${Date.now()}`,
          },
        );
      }
      return result.rows.length;
    },
  );
}

async function main(): Promise<void> {
  const workspaces = await loadWorkspaces();
  let cards = 0;
  for (const workspace of workspaces) {
    cards += await resyncWorkspace(workspace);
  }
  console.log(JSON.stringify({ workspaces: workspaces.length, cards }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
