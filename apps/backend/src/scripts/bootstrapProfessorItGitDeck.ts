import { randomUUID } from "node:crypto";
import {
  createCatalogAuthorInExecutor,
  createCatalogPackageDraftInExecutor,
  createCatalogPackageVersionFromCardsInExecutor,
  installCatalogPackageVersionInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "../catalog";
import { transactionWithWorkspaceScope } from "../database";
import { unsafeTransaction } from "../database/core";
import { registerProfessorITSharedCardsInExecutor } from "../professorit/sharedCards";
import { buildSystemWorkspaceReplicaId } from "../sync/identity/replica";
import { professorItGitDeck } from "./data/professorItGitDeck";

const packageSlug = "professor-it-git-foundation";
const packageTitle = "Git: собеседование и практика";
const adminEmail = "admin@professorit.ru";
const deckRelease = 1;

type CatalogAuthorRow = Readonly<{ author_id: string }>;
type CatalogPackageRow = Readonly<{ package_id: string }>;
type PublishedVersionRow = Readonly<{
  package_version_id: string;
  version_number: number;
  card_count: number;
}>;
const targetUserId = process.env.PROFESSORIT_TARGET_USER_ID;
const targetWorkspaceId = process.env.PROFESSORIT_TARGET_WORKSPACE_ID;

async function publishDeck(): Promise<string> {
  return unsafeTransaction(async (executor) => {
    const existingAuthor = await executor.query<CatalogAuthorRow>(
      "SELECT author_id FROM catalog.authors WHERE slug = 'professor-it'",
      [],
    );
    let authorId = existingAuthor.rows[0]?.author_id;
    if (authorId === undefined) {
      authorId = randomUUID();
      await createCatalogAuthorInExecutor(executor, {
        authorId,
        slug: "professor-it",
        displayName: "Professor IT",
        bio: "Учебные материалы Professor IT.",
        websiteUrl: "https://professorit.ru",
      });
    }

    const existingPackage = await executor.query<CatalogPackageRow>(
      "SELECT package_id FROM catalog.packages WHERE slug = $1",
      [packageSlug],
    );
    let packageId = existingPackage.rows[0]?.package_id;
    if (packageId === undefined) {
      packageId = randomUUID();
      await createCatalogPackageDraftInExecutor(executor, {
        packageId,
        authorId,
        slug: packageSlug,
        title: packageTitle,
        summary: "Вопросы по Git для собеседования и ежедневной работы.",
        description: `${professorItGitDeck.length} карточек по зонам Git, командам, веткам, удалённым репозиториям и восстановлению.`,
        languageTags: ["ru"],
        license: "Professor IT — только для учеников",
        contentWarning: null,
      });
    }

    const published = await executor.query<PublishedVersionRow>(
      [
        "SELECT package_version_id, version_number, card_count",
        "FROM catalog.package_versions",
        "WHERE package_id = $1 AND status = 'published'",
        "ORDER BY version_number DESC LIMIT 1",
      ].join(" "),
      [packageId],
    );
    const current = published.rows[0];
    if (current !== undefined && current.version_number >= deckRelease) {
      if (current.card_count !== professorItGitDeck.length) {
        throw new Error(
          `Published Git deck has ${current.card_count} cards, expected ${professorItGitDeck.length}.`,
        );
      }
      return current.package_version_id;
    }

    const createdAt = new Date().toISOString();
    const packageVersionId = randomUUID();
    await createCatalogPackageVersionFromCardsInExecutor(
      executor,
      packageId,
      {
        packageVersionId,
        cards: professorItGitDeck.map((card, index) => ({
          packageCardId: randomUUID(),
          stableCardKey: card.key,
          ordinal: index + 1,
          frontText: card.frontText,
          backText: card.backText,
          cardType: "basic",
          metadata: {
            version: 1,
            source: {
              label: "Professor IT: курс Git",
              author: "Professor IT",
              comment: card.topic,
              createdAt,
              importedAt: createdAt,
              importId: packageSlug,
            },
          },
          tags: ["git", "professorit-git", card.topic],
          mediaAssetKeys: [],
        })),
      },
      adminEmail,
    );
    await updateCatalogPackageVersionReviewStatusInExecutor(
      executor,
      packageVersionId,
      { status: "submitted", note: "Колода Git Professor IT." },
      adminEmail,
    );
    await updateCatalogPackageVersionReviewStatusInExecutor(
      executor,
      packageVersionId,
      { status: "approved", note: "Проверено автором курса." },
      adminEmail,
    );
    await publishCatalogPackageVersionInExecutor(
      executor,
      packageVersionId,
      adminEmail,
      "Доступно всем ученикам Professor IT.",
    );
    return packageVersionId;
  });
}

async function installForAuthors(packageVersionId: string): Promise<number> {
  if (targetUserId === undefined || targetWorkspaceId === undefined) {
    throw new Error(
      "Set PROFESSORIT_TARGET_USER_ID and PROFESSORIT_TARGET_WORKSPACE_ID for the author workspace.",
    );
  }

  return transactionWithWorkspaceScope(
    { userId: targetUserId, workspaceId: targetWorkspaceId },
    async (executor) => {
      const existing = await executor.query<Readonly<{ count: string }>>(
        [
          "SELECT count(*) FROM sync.catalog_package_install_idempotency",
          "WHERE workspace_id = $1 AND package_version_id = $2",
        ].join(" "),
        [targetWorkspaceId, packageVersionId],
      );
      let installed = 0;
      if (Number(existing.rows[0]?.count ?? "0") === 0) {
        const installedAt = new Date().toISOString();
        const replicaId = buildSystemWorkspaceReplicaId(
          targetWorkspaceId,
          "workspace_seed",
          "workspace-seed",
        );
        await installCatalogPackageVersionInExecutor(
          executor,
          targetWorkspaceId,
          packageVersionId,
          {
            installId: `professorit-git-${packageVersionId}`,
            installedAt,
            clientUpdatedAt: installedAt,
            lastModifiedByReplicaId: replicaId,
            operationIdPrefix: `professorit-git-${packageVersionId}`,
            addImportTag: true,
            importTag: "Professor IT · Git",
          },
        );
        installed += professorItGitDeck.length;
      }
      await registerProfessorITSharedCardsInExecutor(executor, targetWorkspaceId);
      return installed;
    },
  );
}

async function main(): Promise<void> {
  const packageVersionId = await publishDeck();
  const installedForAuthors = await installForAuthors(packageVersionId);
  console.log(
    JSON.stringify(
      {
        packageSlug,
        packageVersionId,
        cards: professorItGitDeck.length,
        installedForAuthors,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
