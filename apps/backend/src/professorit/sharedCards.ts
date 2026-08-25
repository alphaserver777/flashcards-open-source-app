import { canManageProfessorItSharedContent } from "../auth/professoritPermissions";
import { createCardInExecutor, deleteCardInExecutor, updateCardInExecutor, upsertCardSnapshotInExecutor } from "../cards";
import type { CardMetadata } from "../cards";
import type { DatabaseExecutor } from "../database";

type SharedCardCopyRow = Readonly<{
  shared_card_id: string;
  card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
  due_at: Date | string | null;
  created_at: Date | string;
  reps: number;
  lapses: number;
  fsrs_card_state: "new" | "learning" | "review" | "relearning";
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: Date | string | null;
  fsrs_scheduled_days: number | null;
  deleted_at: Date | string | null;
  last_modified_by_replica_id: string;
  shared_front_text: string;
  shared_back_text: string;
  shared_card_type: string;
  subject_slug: string;
  topic_slug: string;
  difficulty: "junior" | "middle" | "senior";
  question_type: "theory" | "command" | "case";
  lms_lesson_id: string | null;
  lms_lesson_title: string | null;
  interview_source: string | null;
  publication_status: "draft" | "published" | "archived";
  shared_updated_at: Date | string;
  shared_updated_at_applied: Date | string;
}>;

type MissingSharedCardRow = Readonly<{
  shared_card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  subject_slug: string;
  topic_slug: string;
  difficulty: "junior" | "middle" | "senior";
  question_type: "theory" | "command" | "case";
  lms_lesson_id: string | null;
  lms_lesson_title: string | null;
  interview_source: string | null;
  publication_status: "published";
  updated_at: Date | string;
}>;

function sharedCardTags(_row: SharedCardCopyRow): ReadonlyArray<string> {
  return [];
}

function sharedCardMetadata(row: SharedCardCopyRow): CardMetadata {
  const lmsBaseUrl = (process.env.PROFESSORIT_LMS_BASE_URL ?? "https://academy.professorit.ru").replace(/\/$/, "");
  return {
    ...row.metadata,
    professorIt: {
      sharedCardId: row.shared_card_id,
      subject: row.subject_slug,
      topic: row.topic_slug,
      difficulty: row.difficulty,
      questionType: row.question_type,
      lmsLessonId: row.lms_lesson_id,
      lmsLessonTitle: row.lms_lesson_title,
      lmsLessonUrl: row.lms_lesson_id === null ? null : `${lmsBaseUrl}/professorit/lesson/${encodeURIComponent(row.lms_lesson_id)}`,
      interviewSource: row.interview_source,
      publicationStatus: row.publication_status,
    },
  };
}

async function applySharedCardPublicationState(
  executor: DatabaseExecutor,
  workspaceId: string,
  row: SharedCardCopyRow,
): Promise<boolean> {
  const updatedAt = toIsoString(row.shared_updated_at);
  const mutationMetadata = {
    clientUpdatedAt: updatedAt,
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: `professorit-shared-state-${row.shared_card_id}-${updatedAt}`,
  };
  if (row.publication_status !== "published") {
    if (row.deleted_at === null) await deleteCardInExecutor(executor, workspaceId, row.card_id, mutationMetadata);
    return true;
  }
  if (row.deleted_at === null) return false;
  await upsertCardSnapshotInExecutor(
    executor,
    workspaceId,
    {
      cardId: row.card_id,
      frontText: row.shared_front_text,
      backText: row.shared_back_text,
      cardType: row.shared_card_type,
      metadata: sharedCardMetadata(row),
      tags: sharedCardTags(row),
      dueAt: row.due_at === null ? null : toIsoString(row.due_at),
      createdAt: toIsoString(row.created_at),
      reps: row.reps,
      lapses: row.lapses,
      fsrsCardState: row.fsrs_card_state,
      fsrsStepIndex: row.fsrs_step_index,
      fsrsStability: row.fsrs_stability,
      fsrsDifficulty: row.fsrs_difficulty,
      fsrsLastReviewedAt: row.fsrs_last_reviewed_at === null ? null : toIsoString(row.fsrs_last_reviewed_at),
      fsrsScheduledDays: row.fsrs_scheduled_days,
      deletedAt: null,
    },
    mutationMetadata,
  );
  return true;
}

function professorITSharedCardsEnabled(): boolean {
  return process.env.AUTH_MODE?.trim().toLowerCase() === "professorit";
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function registerProfessorITSharedCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  promoteAuthorCards = false,
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

  if (promoteAuthorCards) {
    await executor.query(
      [
        "WITH author_cards AS (",
        "SELECT cards.card_id, cards.front_text, cards.back_text, cards.card_type,",
        "cards.metadata->'professorIt'->>'subject' AS subject_slug,",
        "cards.metadata->'professorIt'->>'topic' AS topic_slug,",
        "cards.metadata->'professorIt'->>'difficulty' AS difficulty,",
        "cards.metadata->'professorIt'->>'questionType' AS question_type",
        "FROM content.cards AS cards",
        "LEFT JOIN content.professorit_shared_card_copies AS copies ON copies.workspace_id = cards.workspace_id AND copies.card_id = cards.card_id",
        "WHERE cards.workspace_id = $1 AND cards.deleted_at IS NULL AND copies.card_id IS NULL",
        "AND cards.metadata->'professorIt'->>'sharedCardId' = 'pending'",
        "), selected_package AS (",
        "SELECT packages.package_id FROM catalog.packages AS packages",
        "INNER JOIN catalog.authors AS authors ON authors.author_id = packages.author_id",
        "WHERE authors.slug = 'professor-it' ORDER BY packages.created_at ASC LIMIT 1",
        "), inserted AS (",
        "INSERT INTO content.professorit_shared_cards",
        "(package_id, stable_card_key, front_text, back_text, card_type, subject_slug, topic_slug, difficulty, question_type, publication_status)",
        "SELECT selected_package.package_id, 'manual-' || author_cards.card_id::text, author_cards.front_text, author_cards.back_text, author_cards.card_type,",
        "author_cards.subject_slug, author_cards.topic_slug, author_cards.difficulty, author_cards.question_type, 'published'",
        "FROM author_cards CROSS JOIN selected_package ON CONFLICT (package_id, stable_card_key) DO NOTHING RETURNING shared_card_id, stable_card_key, updated_at",
        ") INSERT INTO content.professorit_shared_card_copies (shared_card_id, workspace_id, card_id, shared_updated_at_applied)",
        "SELECT inserted.shared_card_id, $1, substring(inserted.stable_card_key from 8)::uuid, inserted.updated_at FROM inserted ON CONFLICT DO NOTHING",
      ].join(" "),
      [workspaceId],
    );
  }

  const missingSharedCards = await executor.query<MissingSharedCardRow>(
    [
      "SELECT shared_cards.shared_card_id, shared_cards.front_text, shared_cards.back_text, shared_cards.card_type,",
      "shared_cards.subject_slug, shared_cards.topic_slug, shared_cards.difficulty, shared_cards.question_type,",
      "shared_cards.lms_lesson_id, shared_cards.lms_lesson_title, shared_cards.interview_source, shared_cards.publication_status, shared_cards.updated_at",
      "FROM content.professorit_shared_cards AS shared_cards",
      "LEFT JOIN content.professorit_shared_card_copies AS copies ON copies.shared_card_id = shared_cards.shared_card_id AND copies.workspace_id = $1",
      "WHERE shared_cards.publication_status = 'published' AND copies.shared_card_id IS NULL",
      "ORDER BY shared_cards.created_at ASC",
    ].join(" "),
    [workspaceId],
  );
  for (const sharedCard of missingSharedCards.rows) {
    const updatedAt = toIsoString(sharedCard.updated_at);
    const lmsBaseUrl = (process.env.PROFESSORIT_LMS_BASE_URL ?? "https://academy.professorit.ru").replace(/\/$/, "");
    const createdCard = await createCardInExecutor(
      executor,
      workspaceId,
      {
        frontText: sharedCard.front_text,
        backText: sharedCard.back_text,
        cardType: sharedCard.card_type,
        tags: [],
        metadata: {
          version: 1,
          source: null,
          professorIt: {
            sharedCardId: sharedCard.shared_card_id,
            subject: sharedCard.subject_slug,
            topic: sharedCard.topic_slug,
            difficulty: sharedCard.difficulty,
            questionType: sharedCard.question_type,
            lmsLessonId: sharedCard.lms_lesson_id,
            lmsLessonTitle: sharedCard.lms_lesson_title,
            lmsLessonUrl: sharedCard.lms_lesson_id === null ? null : `${lmsBaseUrl}/professorit/lesson/${encodeURIComponent(sharedCard.lms_lesson_id)}`,
            interviewSource: sharedCard.interview_source,
            publicationStatus: sharedCard.publication_status,
          },
        },
      },
      {
        clientUpdatedAt: updatedAt,
        lastModifiedByReplicaId: "professorit-shared-content",
        lastOperationId: `professorit-shared-create-${sharedCard.shared_card_id}-${workspaceId}`,
      },
    );
    await executor.query(
      "INSERT INTO content.professorit_shared_card_copies (shared_card_id, workspace_id, card_id, shared_updated_at_applied) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [sharedCard.shared_card_id, workspaceId, createdCard.cardId, sharedCard.updated_at],
    );
  }
}

export async function synchronizeProfessorITSharedCardsInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  if (professorITSharedCardsEnabled() === false) return;
  await registerProfessorITSharedCardsInExecutor(executor, workspaceId, canManageProfessorItSharedContent(userId));

  const result = await executor.query<SharedCardCopyRow>(
    [
      "SELECT shared_cards.shared_card_id, cards.card_id, cards.front_text, cards.back_text, cards.card_type, cards.metadata, cards.tags,",
      "cards.due_at, cards.created_at, cards.reps, cards.lapses, cards.fsrs_card_state, cards.fsrs_step_index,",
      "cards.fsrs_stability, cards.fsrs_difficulty, cards.fsrs_last_reviewed_at, cards.fsrs_scheduled_days, cards.deleted_at,",
      "cards.last_modified_by_replica_id, copies.shared_updated_at_applied,",
      "shared_cards.front_text AS shared_front_text, shared_cards.back_text AS shared_back_text,",
      "shared_cards.card_type AS shared_card_type, shared_cards.subject_slug, shared_cards.topic_slug,",
      "shared_cards.difficulty, shared_cards.question_type, shared_cards.lms_lesson_id, shared_cards.lms_lesson_title, shared_cards.interview_source,",
      "shared_cards.publication_status, shared_cards.updated_at AS shared_updated_at",
      "FROM content.professorit_shared_card_copies AS copies",
      "INNER JOIN content.professorit_shared_cards AS shared_cards ON shared_cards.shared_card_id = copies.shared_card_id",
      "INNER JOIN content.cards AS cards ON cards.workspace_id = copies.workspace_id AND cards.card_id = copies.card_id",
      "WHERE copies.workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );

  if (canManageProfessorItSharedContent(userId)) {
    for (const row of result.rows) {
      if (await applySharedCardPublicationState(executor, workspaceId, row)) {
        await executor.query(
          "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
          [row.shared_card_id, workspaceId, row.shared_updated_at],
        );
        continue;
      }
      const desiredTags = sharedCardTags(row);
      const desiredMetadata = sharedCardMetadata(row);
      const authorContentChanged = row.front_text !== row.shared_front_text
        || row.back_text !== row.shared_back_text
        || row.card_type !== row.shared_card_type
        || JSON.stringify(row.metadata.professorIt) !== JSON.stringify(desiredMetadata.professorIt);
      const tagsChanged = JSON.stringify(row.tags) !== JSON.stringify(desiredTags);
      if (authorContentChanged === false && tagsChanged === false) {
        if (new Date(row.shared_updated_at_applied).getTime() < new Date(row.shared_updated_at).getTime()) {
          await executor.query(
            "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
            [row.shared_card_id, workspaceId, row.shared_updated_at],
          );
        }
        continue;
      }
      if (authorContentChanged && new Date(row.shared_updated_at_applied).getTime() >= new Date(row.shared_updated_at).getTime()) {
        const editedMetadata = row.metadata.professorIt;
        await executor.query("SELECT set_config('professorit.changed_by_user_id', $1, true), set_config('professorit.change_reason', 'author_edit', true)", [userId]);
        const updatedSharedCard = await executor.query<Readonly<{ updated_at: Date | string }>>(
          [
            "UPDATE content.professorit_shared_cards SET front_text = $2, back_text = $3, card_type = $4,",
            "subject_slug = $5, topic_slug = $6, difficulty = $7, question_type = $8,",
            "lms_lesson_id = $9, lms_lesson_title = $10, publication_status = $11, interview_source = $12, updated_at = now()",
            "WHERE shared_card_id = $1 RETURNING updated_at",
          ].join(" "),
          [
            row.shared_card_id,
            row.front_text,
            row.back_text,
            row.card_type,
            editedMetadata?.subject ?? row.subject_slug,
            editedMetadata?.topic ?? row.topic_slug,
            editedMetadata?.difficulty ?? row.difficulty,
            editedMetadata?.questionType ?? row.question_type,
            editedMetadata?.lmsLessonId ?? row.lms_lesson_id,
            editedMetadata?.lmsLessonTitle ?? row.lms_lesson_title,
            editedMetadata?.publicationStatus ?? row.publication_status,
            editedMetadata?.interviewSource ?? row.interview_source,
          ],
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
          tags: desiredTags,
          metadata: desiredMetadata,
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
    if (await applySharedCardPublicationState(executor, workspaceId, row)) {
      await executor.query(
        "UPDATE content.professorit_shared_card_copies SET shared_updated_at_applied = $3 WHERE shared_card_id = $1 AND workspace_id = $2",
        [row.shared_card_id, workspaceId, row.shared_updated_at],
      );
      continue;
    }
    const desiredTags = sharedCardTags(row);
    const desiredMetadata = sharedCardMetadata(row);
    const contentMatches = (
      row.front_text === row.shared_front_text
      && row.back_text === row.shared_back_text
      && row.card_type === row.shared_card_type
      && JSON.stringify(row.tags) === JSON.stringify(desiredTags)
      && JSON.stringify(row.metadata.professorIt) === JSON.stringify(desiredMetadata.professorIt)
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
        tags: desiredTags,
        metadata: desiredMetadata,
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
