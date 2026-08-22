import { randomUUID } from "node:crypto";
import { transactionWithWorkspaceScope } from "../database";
import { unsafeTransaction } from "../database/core";
import {
  createCatalogAuthorInExecutor,
  createCatalogPackageDraftInExecutor,
  createCatalogPackageVersionFromCardsInExecutor,
  installCatalogPackageVersionInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "../catalog";
import type { CardMetadata } from "../cards/types";
import { deleteCardInExecutor } from "../cards";

type SourceCard = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
}>;

const sourceWorkspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";
const sourceUserId = "local";
const targetUserId = process.env.PROFESSORIT_TARGET_USER_ID;
const targetWorkspaceId = process.env.PROFESSORIT_TARGET_WORKSPACE_ID;
const targetReplicaId = process.env.PROFESSORIT_TARGET_REPLICA_ID;

if (!targetUserId || !targetWorkspaceId || !targetReplicaId) {
  throw new Error("Set PROFESSORIT_TARGET_USER_ID, PROFESSORIT_TARGET_WORKSPACE_ID and PROFESSORIT_TARGET_REPLICA_ID.");
}

const packageSlug = "professor-it-linux-foundation";
const adminEmail = "admin@professorit.ru";

async function main(): Promise<void> {
const cards = await transactionWithWorkspaceScope({ userId: sourceUserId, workspaceId: sourceWorkspaceId }, async (executor) => {
  return executor.query<SourceCard>(
    [
      "SELECT card_id, front_text, back_text, card_type, metadata, tags",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND tags @> ARRAY['linux']::text[]",
      "ORDER BY created_at ASC, card_id ASC",
    ].join(" "),
    [sourceWorkspaceId],
  );
});
if (cards.rows.length !== 68) {
  throw new Error(`Expected 68 Linux cards, received ${cards.rows.length}.`);
}

const packageVersionId = await unsafeTransaction(async (executor) => {

  const existing = await executor.query<Readonly<{ package_version_id: string }>>(
    [
      "SELECT versions.package_version_id",
      "FROM catalog.packages AS packages",
      "INNER JOIN catalog.package_versions AS versions ON versions.package_id = packages.package_id",
      "WHERE packages.slug = $1 AND versions.status = 'published'",
      "ORDER BY versions.version_number DESC LIMIT 1",
    ].join(" "),
    [packageSlug],
  );
  if (existing.rows[0]) return existing.rows[0].package_version_id;

  const authorId = randomUUID();
  await createCatalogAuthorInExecutor(executor, {
    authorId,
    slug: "professor-it",
    displayName: "Professor IT",
    bio: "Учебные материалы Professor IT.",
    websiteUrl: "https://professorit.ru",
  });
  const packageId = randomUUID();
  await createCatalogPackageDraftInExecutor(executor, {
    packageId,
    authorId,
    slug: packageSlug,
    title: "Linux: фундамент DevOps-инженера",
    summary: "Базовая колода для повторения Linux-команд и понятий.",
    description: "68 карточек по Linux из базы знаний Professor IT.",
    languageTags: ["ru"],
    license: "Professor IT — только для учеников",
    contentWarning: null,
  });
  const versionId = randomUUID();
  await createCatalogPackageVersionFromCardsInExecutor(executor, packageId, {
    packageVersionId: versionId,
    cards: cards.rows.map((card, ordinal) => ({
      packageCardId: randomUUID(),
      stableCardKey: card.card_id,
      ordinal: ordinal + 1,
      frontText: card.front_text,
      backText: card.back_text,
      cardType: card.card_type,
      metadata: card.metadata,
      tags: card.tags,
      mediaAssetKeys: [],
    })),
  }, adminEmail);
  await updateCatalogPackageVersionReviewStatusInExecutor(executor, versionId, { status: "submitted", note: "Первая колода Professor IT." }, adminEmail);
  await updateCatalogPackageVersionReviewStatusInExecutor(executor, versionId, { status: "approved", note: "Проверено автором курса." }, adminEmail);
  await publishCatalogPackageVersionInExecutor(executor, versionId, adminEmail, "Доступно ученикам Professor IT.");
  return versionId;
});

const now = new Date().toISOString();
const installId = `professorit-linux-${targetWorkspaceId}`;
const existingInstall = await transactionWithWorkspaceScope({ userId: targetUserId, workspaceId: targetWorkspaceId }, async (executor) => (
  executor.query<Readonly<{ count: string }>>(
    "SELECT count(*) FROM content.cards WHERE workspace_id = $1 AND deleted_at IS NULL AND metadata->'source'->>'importId' = $2",
    [targetWorkspaceId, installId],
  )
));
const existingCount = Number(existingInstall.rows[0]?.count ?? "0");
const installedCards = existingCount === 0
  ? (await transactionWithWorkspaceScope({ userId: targetUserId, workspaceId: targetWorkspaceId }, async (executor) => (
    installCatalogPackageVersionInExecutor(executor, targetWorkspaceId, packageVersionId, {
      installId,
      installedAt: now,
      clientUpdatedAt: now,
      lastModifiedByReplicaId: targetReplicaId,
      operationIdPrefix: `professorit-linux-${Date.now()}`,
      addImportTag: true,
      importTag: "Professor IT · Linux",
    })
  ))).summary.cardCount
  : existingCount;

await transactionWithWorkspaceScope({ userId: targetUserId, workspaceId: targetWorkspaceId }, async (executor) => {
  const demo = await executor.query<Readonly<{ card_id: string }>>(
    [
      "SELECT card_id FROM content.cards",
      "WHERE workspace_id = $1 AND tags @> ARRAY['demo']::text[] AND deleted_at IS NULL",
      "ORDER BY created_at ASC LIMIT 1",
    ].join(" "),
    [targetWorkspaceId],
  );
  const card = demo.rows[0];
  if (card) {
    await deleteCardInExecutor(executor, targetWorkspaceId, card.card_id, {
      clientUpdatedAt: now,
      lastModifiedByReplicaId: targetReplicaId,
      lastOperationId: `professorit-remove-demo-${Date.now()}`,
    });
  }
});

console.log(JSON.stringify({ packageVersionId, installedCards }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
