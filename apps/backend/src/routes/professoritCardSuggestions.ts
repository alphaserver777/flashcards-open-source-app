import { createHmac, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { canManageProfessorItSharedContent } from "../auth/professoritPermissions";
import { transactionWithWorkspaceScope } from "../database";
import { unsafeQuery } from "../database/unsafe";
import { HttpError } from "../shared/errors";
import { loadRequestContextFromRequest, parseWorkspaceIdParam } from "../server/requestContext";
import { expectNonEmptyString, expectRecord, expectUuidString, parseJsonBody } from "../server/requestParsing";
import type { AppEnv } from "../server/app";

type Options = Readonly<{ allowedOrigins: ReadonlyArray<string> }>;

type SuggestionRow = Readonly<{
  suggestion_id: string;
  user_id: string;
  workspace_id: string;
  card_id: string;
  kind: "improvement" | "error";
  message: string;
  status: "pending" | "accepted" | "rejected";
  author_comment: string | null;
  created_at: Date | string;
  front_text: string;
  submitter_display_name: string | null;
  submitter_email: string | null;
}>;

type SuggestionCardRow = Readonly<{
  card_id: string;
  front_text: string;
}>;

type SubmitterRow = Readonly<{
  display_name: string | null;
  email: string | null;
}>;

type LmsLessonSearchResult = Readonly<{
  lesson_id: string;
  title: string;
  course: string;
  chapter: string;
  stable_url: string;
}>;

type SharedCardQuestionRow = Readonly<{
  shared_card_id: string;
  front_text: string;
  subject_slug: string;
  topic_slug: string;
  publication_status: "draft" | "published" | "archived";
}>;

const duplicateQuestionStopWords = new Set([
  "как", "какая", "какие", "какой", "что", "это", "чем", "для", "при", "или", "его", "она", "они", "между", "можно",
]);

function questionTokens(value: string): ReadonlySet<string> {
  return new Set(value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").match(/[a-zа-я0-9]+/gu)?.filter((token) => token.length >= 3 && !duplicateQuestionStopWords.has(token)) ?? []);
}

function questionSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / (left.size + right.size - common);
}

function requireAuthor(userId: string): void {
  if (canManageProfessorItSharedContent(userId) === false) {
    throw new HttpError(403, "Only the Professor IT author can review suggestions.", "SHARED_CONTENT_FORBIDDEN");
  }
}

export function createProfessorItCardSuggestionRoutes(options: Options): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/workspaces/:workspaceId/cards/:cardId/suggestions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const cardId = expectUuidString(context.req.param("cardId"), "cardId");
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const kind = expectNonEmptyString(body.kind, "kind");
    const message = expectNonEmptyString(body.message, "message");
    if (kind !== "improvement" && kind !== "error") {
      throw new HttpError(400, "kind must be improvement or error");
    }
    if (message.length > 5000) {
      throw new HttpError(400, "message must not exceed 5000 characters");
    }

    const suggestionId = randomUUID();
    await transactionWithWorkspaceScope({ userId: requestContext.userId, workspaceId }, async (executor) => {
      const card = await executor.query<SuggestionCardRow>("SELECT card_id, front_text FROM content.cards WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL", [workspaceId, cardId]);
      const cardRow = card.rows[0];
      if (cardRow === undefined) {
        throw new HttpError(404, "Card not found");
      }
      const submitter = await executor.query<SubmitterRow>(
        "SELECT display_name, email FROM org.user_settings WHERE user_id = $1",
        [requestContext.userId],
      );
      const submitterRow = submitter.rows[0];
      await executor.query(
        "INSERT INTO content.professorit_card_suggestions (suggestion_id, user_id, workspace_id, card_id, kind, message, front_text, submitter_display_name, submitter_email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [suggestionId, requestContext.userId, workspaceId, cardId, kind, message, cardRow.front_text, submitterRow?.display_name ?? null, submitterRow?.email ?? null],
      );
    });
    return context.json({ ok: true, suggestionId }, 201);
  });

  app.get("/professorit/card-suggestions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const result = await unsafeQuery<SuggestionRow>(
      [
        "SELECT suggestions.*",
        "FROM content.professorit_card_suggestions AS suggestions",
        "WHERE suggestions.status = 'pending'",
        "ORDER BY suggestions.created_at DESC",
        "LIMIT 500",
      ].join(" "),
      [],
    );
    return context.json({ suggestions: result.rows.map((row) => ({
      suggestionId: row.suggestion_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      cardId: row.card_id,
      kind: row.kind,
      message: row.message,
      status: row.status,
      authorComment: row.author_comment,
      createdAt: new Date(row.created_at).toISOString(),
      frontText: row.front_text,
      submitterDisplayName: row.submitter_display_name,
      submitterEmail: row.submitter_email,
    })) });
  });

  app.get("/professorit/lms-lessons", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const query = (context.req.query("query") ?? "").trim();
    const limit = 20;
    const secret = process.env.PROFESSORIT_LESSON_SEARCH_SECRET?.trim() ?? "";
    if (secret === "") throw new HttpError(503, "LMS lesson search is not configured");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", secret).update(`${timestamp}\n${query}\n${limit}`).digest("hex");
    const baseUrl = (process.env.PROFESSORIT_LMS_INTERNAL_URL ?? "https://academy.professorit.ru").replace(/\/$/, "");
    const searchUrl = new URL(`${baseUrl}/api/method/professorit_lms.lessons.search_lessons_internal`);
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("limit", limit.toString());
    searchUrl.searchParams.set("timestamp", timestamp);
    searchUrl.searchParams.set("signature", signature);
    const response = await fetch(searchUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new HttpError(502, "LMS lesson search failed");
    const body = await response.json() as Readonly<{ message?: unknown }>;
    const lessons = Array.isArray(body.message) ? body.message as ReadonlyArray<LmsLessonSearchResult> : [];
    return context.json({ lessons });
  });

  app.get("/professorit/shared-cards/near-duplicates", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const result = await unsafeQuery<SharedCardQuestionRow>(
      "SELECT shared_card_id, front_text, subject_slug, topic_slug, publication_status FROM content.professorit_shared_cards WHERE publication_status <> 'archived' ORDER BY subject_slug, front_text",
      [],
    );
    const cards = result.rows.map((row) => ({ ...row, tokens: questionTokens(row.front_text) }));
    const pairs: Array<Readonly<Record<string, unknown>>> = [];
    for (let leftIndex = 0; leftIndex < cards.length; leftIndex += 1) {
      const left = cards[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < cards.length; rightIndex += 1) {
        const right = cards[rightIndex];
        if (right === undefined || left.subject_slug !== right.subject_slug) continue;
        const similarity = questionSimilarity(left.tokens, right.tokens);
        if (similarity < 0.65 || similarity >= 1) continue;
        pairs.push({
          leftSharedCardId: left.shared_card_id,
          leftQuestion: left.front_text,
          leftStatus: left.publication_status,
          rightSharedCardId: right.shared_card_id,
          rightQuestion: right.front_text,
          rightStatus: right.publication_status,
          subject: left.subject_slug,
          similarity: Math.round(similarity * 100),
        });
      }
    }
    pairs.sort((left, right) => Number(right.similarity) - Number(left.similarity));
    return context.json({ pairs: pairs.slice(0, 100) });
  });

  app.post("/professorit/card-suggestions/:suggestionId/status", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const suggestionId = expectUuidString(context.req.param("suggestionId"), "suggestionId");
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const status = expectNonEmptyString(body.status, "status");
    if (status !== "accepted" && status !== "rejected") {
      throw new HttpError(400, "status must be accepted or rejected");
    }
    const authorComment = typeof body.authorComment === "string" ? body.authorComment.trim() : null;
    if (status === "accepted") {
      const sharedUpdate = await unsafeQuery(
        [
          "WITH change_context AS (",
          "SELECT set_config('professorit.changed_by_user_id', $2, true), set_config('professorit.change_reason', 'accepted_suggestion', true)",
          ")",
          "UPDATE content.professorit_shared_cards AS shared_cards",
          "SET back_text = suggestions.message, updated_at = now()",
          "FROM content.professorit_card_suggestions AS suggestions",
          "INNER JOIN content.professorit_shared_card_copies AS copies",
          "ON copies.workspace_id = suggestions.workspace_id AND copies.card_id = suggestions.card_id",
          "CROSS JOIN change_context",
          "WHERE suggestions.suggestion_id = $1 AND shared_cards.shared_card_id = copies.shared_card_id",
          "RETURNING shared_cards.shared_card_id",
        ].join(" "),
        [suggestionId, requestContext.userId],
      );
      if (sharedUpdate.rowCount === 0) {
        throw new HttpError(409, "Suggestion is not linked to a shared card");
      }
    }
    await unsafeQuery(
      "UPDATE content.professorit_card_suggestions SET status = $2, author_comment = $3, updated_at = now() WHERE suggestion_id = $1",
      [suggestionId, status, authorComment === "" ? null : authorComment],
    );
    return context.json({ ok: true });
  });

  app.post("/professorit/card-suggestions/:suggestionId/message", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const suggestionId = expectUuidString(context.req.param("suggestionId"), "suggestionId");
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const message = expectNonEmptyString(body.message, "message");
    if (message.length > 5000) {
      throw new HttpError(400, "message must not exceed 5000 characters");
    }
    const result = await unsafeQuery(
      "UPDATE content.professorit_card_suggestions SET message = $2, updated_at = now() WHERE suggestion_id = $1 RETURNING suggestion_id",
      [suggestionId, message],
    );
    if (result.rowCount === 0) {
      throw new HttpError(404, "Suggestion not found");
    }
    return context.json({ ok: true });
  });

  app.post("/professorit/shared-cards/from-copy/:cardId", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const cardId = expectUuidString(context.req.param("cardId"), "cardId");
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const workspaceId = expectUuidString(body.workspaceId, "workspaceId");
    const subject = expectNonEmptyString(body.subject, "subject");
    const topic = expectNonEmptyString(body.topic, "topic");
    const difficulty = expectNonEmptyString(body.difficulty, "difficulty");
    const questionType = expectNonEmptyString(body.questionType, "questionType");
    if (!["junior", "middle", "senior"].includes(difficulty)) throw new HttpError(400, "Unsupported difficulty");
    if (!["theory", "command", "case"].includes(questionType)) throw new HttpError(400, "Unsupported question type");

    const result = await transactionWithWorkspaceScope({ userId: requestContext.userId, workspaceId }, async (executor) => {
      const card = await executor.query<Readonly<{ front_text: string; back_text: string; card_type: string }>>(
        "SELECT front_text, back_text, card_type FROM content.cards WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
        [workspaceId, cardId],
      );
      const cardRow = card.rows[0];
      if (cardRow === undefined) throw new HttpError(404, "Card not found");
      const packageResult = await executor.query<Readonly<{ package_id: string }>>(
        [
          "SELECT packages.package_id FROM catalog.packages AS packages",
          "INNER JOIN catalog.authors AS authors ON authors.author_id = packages.author_id",
          "WHERE authors.slug = 'professor-it'",
          "ORDER BY CASE WHEN lower(packages.slug) LIKE $1 THEN 0 ELSE 1 END, packages.created_at ASC LIMIT 1",
        ].join(" "),
        [`%${subject.toLowerCase()}%`],
      );
      const packageId = packageResult.rows[0]?.package_id;
      if (packageId === undefined) throw new HttpError(409, "Professor IT package not found");
      const shared = await executor.query<Readonly<{ shared_card_id: string }>>(
        [
          "INSERT INTO content.professorit_shared_cards",
          "(package_id, stable_card_key, front_text, back_text, card_type, subject_slug, topic_slug, difficulty, question_type, publication_status)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published') RETURNING shared_card_id",
        ].join(" "),
        [packageId, `manual-${cardId}`, cardRow.front_text, cardRow.back_text, cardRow.card_type, subject, topic, difficulty, questionType],
      );
      const sharedCardId = shared.rows[0]?.shared_card_id;
      if (sharedCardId === undefined) throw new Error("Shared card insert did not return a row");
      await executor.query(
        "INSERT INTO content.professorit_shared_card_copies (shared_card_id, workspace_id, card_id, shared_updated_at_applied) SELECT shared_card_id, $2, $3, updated_at FROM content.professorit_shared_cards WHERE shared_card_id = $1",
        [sharedCardId, workspaceId, cardId],
      );
      return sharedCardId;
    });
    return context.json({ ok: true, sharedCardId: result }, 201);
  });

  app.get("/professorit/shared-cards/:sharedCardId/history", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireAuthor(requestContext.userId);
    const sharedCardId = expectUuidString(context.req.param("sharedCardId"), "sharedCardId");
    const result = await unsafeQuery(
      "SELECT history_id, changed_by_user_id, change_reason, previous_value, current_value, created_at FROM content.professorit_shared_card_history WHERE shared_card_id = $1 ORDER BY created_at DESC LIMIT 200",
      [sharedCardId],
    );
    return context.json({ history: result.rows });
  });

  return app;
}
