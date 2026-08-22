import { canManageProfessorItSharedContent } from "../auth/professoritPermissions";
import { deleteCardInExecutor } from "../cards";
import { installCatalogPackageVersionInExecutor } from "../catalog";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../database";
import { buildSystemWorkspaceReplicaId } from "../sync/identity/replica";
import { synchronizeProfessorITSharedCardsInExecutor } from "./sharedCards";

type PublishedPackageVersion = Readonly<{
  package_version_id: string;
  title: string;
  published_at: Date | string;
}>;

type DemoCard = Readonly<{
  card_id: string;
}>;

function professorITSharedDecksEnabled(): boolean {
  return process.env.AUTH_MODE?.trim().toLowerCase() === "professorit";
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function ensureProfessorITSharedDecksInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  if (
    professorITSharedDecksEnabled() === false
    || canManageProfessorItSharedContent(userId)
  ) {
    return;
  }

  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
  await executor.query(
    "UPDATE org.workspaces SET name = 'Моё обучение' WHERE workspace_id = $1 AND name = 'Personal'",
    [workspaceId],
  );

  const publishedVersions = await executor.query<PublishedPackageVersion>(
    [
      "SELECT DISTINCT ON (packages.package_id)",
      "versions.package_version_id, versions.title, versions.published_at",
      "FROM catalog.authors AS authors",
      "INNER JOIN catalog.packages AS packages ON packages.author_id = authors.author_id",
      "INNER JOIN catalog.package_versions AS versions ON versions.package_id = packages.package_id",
      "LEFT JOIN sync.catalog_package_install_idempotency AS installs",
      "ON installs.workspace_id = $1 AND installs.package_version_id = versions.package_version_id",
      "WHERE authors.slug = 'professor-it'",
      "AND versions.status = 'published'",
      "AND versions.published_at IS NOT NULL",
      "AND installs.package_version_id IS NULL",
      "ORDER BY packages.package_id, versions.version_number DESC",
    ].join(" "),
    [workspaceId],
  );

  const replicaId = buildSystemWorkspaceReplicaId(
    workspaceId,
    "workspace_seed",
    "workspace-seed",
  );

  for (const version of publishedVersions.rows) {
    const installedAt = toIsoString(version.published_at);
    await installCatalogPackageVersionInExecutor(
      executor,
      workspaceId,
      version.package_version_id,
      {
        installId: `professorit-auto-${version.package_version_id}`,
        installedAt,
        clientUpdatedAt: installedAt,
        lastModifiedByReplicaId: replicaId,
        operationIdPrefix: `professorit-auto-${version.package_version_id}`,
        addImportTag: true,
        importTag: `Professor IT · ${version.title}`,
      },
    );
  }

  const demoCards = await executor.query<DemoCard>(
    [
      "SELECT card_id FROM content.cards",
      "WHERE workspace_id = $1",
      "AND deleted_at IS NULL",
      "AND tags @> ARRAY['demo']::text[]",
      "AND metadata->'source'->>'importId' IS NULL",
    ].join(" "),
    [workspaceId],
  );
  const deletedAt = new Date().toISOString();
  for (const card of demoCards.rows) {
    await deleteCardInExecutor(executor, workspaceId, card.card_id, {
      clientUpdatedAt: deletedAt,
      lastModifiedByReplicaId: replicaId,
      lastOperationId: `professorit-remove-demo-${card.card_id}`,
    });
  }
  await synchronizeProfessorITSharedCardsInExecutor(executor, userId, workspaceId);
}
