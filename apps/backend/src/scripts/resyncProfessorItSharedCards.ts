import { updateCardInExecutor } from "../cards";
import type { CardMetadata } from "../cards";
import { transactionWithWorkspaceScope } from "../database";
import { unsafeTransaction } from "../database/core";
import { buildSystemWorkspaceReplicaId } from "../sync/identity/replica";

type WorkspaceMemberRow = Readonly<{
  workspace_id: string;
  user_id: string;
}>;

type SharedCardRow = Readonly<{
  card_id: string;
  metadata: CardMetadata;
  shared_card_id: string;
  subject_slug: string;
  topic_slug: string;
  difficulty: "junior" | "middle" | "senior";
  question_type: "theory" | "command" | "case";
  lms_lesson_id: string | null;
  lms_lesson_title: string | null;
  interview_source: string | null;
  publication_status: "draft" | "published" | "archived";
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
          "SELECT cards.card_id, cards.metadata, shared.shared_card_id, shared.subject_slug, shared.topic_slug,",
          "shared.difficulty, shared.question_type, shared.lms_lesson_id, shared.lms_lesson_title,",
          "shared.interview_source, shared.publication_status",
          "FROM content.professorit_shared_card_copies copies",
          "INNER JOIN content.cards cards ON cards.workspace_id = copies.workspace_id AND cards.card_id = copies.card_id",
          "INNER JOIN content.professorit_shared_cards shared ON shared.shared_card_id = copies.shared_card_id",
          "WHERE copies.workspace_id = $1 AND shared.publication_status = 'published'",
          "ORDER BY cards.card_id",
        ].join(" "),
        [workspace.workspace_id],
      );
      const baseUrl = (process.env.PROFESSORIT_LMS_BASE_URL ?? "https://academy.professorit.ru").replace(/\/$/, "");
      const replicaId = buildSystemWorkspaceReplicaId(workspace.workspace_id, "workspace_seed", "workspace-seed");
      for (const card of result.rows) {
        await updateCardInExecutor(
          executor,
          workspace.workspace_id,
          card.card_id,
          {
            metadata: {
              ...card.metadata,
              professorIt: {
                sharedCardId: card.shared_card_id,
                subject: card.subject_slug,
                topic: card.topic_slug,
                difficulty: card.difficulty,
                questionType: card.question_type,
                lmsLessonId: card.lms_lesson_id,
                lmsLessonTitle: card.lms_lesson_title,
                lmsLessonUrl: card.lms_lesson_id === null ? null : `${baseUrl}/professorit/lesson/${encodeURIComponent(card.lms_lesson_id)}`,
                interviewSource: card.interview_source,
                publicationStatus: card.publication_status,
              },
            },
          },
          {
            clientUpdatedAt: new Date().toISOString(),
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
