import { randomUUID } from "node:crypto";
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
        "ORDER BY CASE suggestions.status WHEN 'pending' THEN 0 ELSE 1 END, suggestions.created_at DESC",
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

  return app;
}
