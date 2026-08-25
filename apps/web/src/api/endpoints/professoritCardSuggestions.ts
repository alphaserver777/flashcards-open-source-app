import { allowAuthRecovery, requestJson } from "../transport/transport";

export type ProfessorItCardSuggestion = Readonly<{
  suggestionId: string;
  userId: string;
  frontText: string;
  kind: "improvement" | "error";
  message: string;
  status: "pending" | "accepted" | "rejected";
  authorComment: string | null;
  createdAt: string;
  submitterDisplayName: string | null;
  submitterEmail: string | null;
}>;

export type ProfessorItLmsLesson = Readonly<{
  lesson_id: string;
  title: string | null;
  course: string;
  chapter: string;
  stable_url: string;
}>;

export async function resolveProfessorItLmsLesson(url: string): Promise<ProfessorItLmsLesson> {
  const response = await requestJson("/professorit/lms-lessons/resolve", {
    method: "POST",
    body: JSON.stringify({ url }),
  }, allowAuthRecovery);
  const lesson = (response.value as { lesson?: unknown } | null)?.lesson;
  if (typeof lesson !== "object" || lesson === null) {
    throw new Error("Не удалось определить урок по ссылке.");
  }
  return lesson as ProfessorItLmsLesson;
}

export type ProfessorItSharedCardHistoryItem = Readonly<{
  historyId: string;
  changedByUserId: string | null;
  changeReason: string | null;
  previousValue: Readonly<Record<string, unknown>>;
  currentValue: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type ProfessorItNearDuplicatePair = Readonly<{
  leftSharedCardId: string;
  leftQuestion: string;
  leftStatus: "draft" | "published" | "archived";
  rightSharedCardId: string;
  rightQuestion: string;
  rightStatus: "draft" | "published" | "archived";
  subject: string;
  similarity: number;
}>;

export async function searchProfessorItLmsLessons(query: string): Promise<ReadonlyArray<ProfessorItLmsLesson>> {
  const response = await requestJson(`/professorit/lms-lessons?query=${encodeURIComponent(query)}`, { method: "GET" }, allowAuthRecovery);
  const lessons = (response.value as { lessons?: unknown } | null)?.lessons;
  return Array.isArray(lessons) ? lessons as ReadonlyArray<ProfessorItLmsLesson> : [];
}

export async function loadProfessorItNearDuplicatePairs(): Promise<ReadonlyArray<ProfessorItNearDuplicatePair>> {
  const response = await requestJson("/professorit/shared-cards/near-duplicates", { method: "GET" }, allowAuthRecovery);
  const pairs = (response.value as { pairs?: unknown } | null)?.pairs;
  return Array.isArray(pairs) ? pairs as ReadonlyArray<ProfessorItNearDuplicatePair> : [];
}

export async function loadProfessorItSharedCardHistory(sharedCardId: string): Promise<ReadonlyArray<ProfessorItSharedCardHistoryItem>> {
  const response = await requestJson(`/professorit/shared-cards/${encodeURIComponent(sharedCardId)}/history`, { method: "GET" }, allowAuthRecovery);
  const rows = (response.value as { history?: unknown } | null)?.history;
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => {
    const row = item as Readonly<Record<string, unknown>>;
    return {
      historyId: String(row.history_id ?? ""),
      changedByUserId: typeof row.changed_by_user_id === "string" ? row.changed_by_user_id : null,
      changeReason: typeof row.change_reason === "string" ? row.change_reason : null,
      previousValue: typeof row.previous_value === "object" && row.previous_value !== null ? row.previous_value as Readonly<Record<string, unknown>> : {},
      currentValue: typeof row.current_value === "object" && row.current_value !== null ? row.current_value as Readonly<Record<string, unknown>> : {},
      createdAt: String(row.created_at ?? ""),
    };
  });
}

export async function submitProfessorItCardSuggestion(input: Readonly<{
  workspaceId: string;
  cardId: string;
  kind: "improvement" | "error";
  message: string;
}>): Promise<void> {
  await requestJson(`/workspaces/${input.workspaceId}/cards/${input.cardId}/suggestions`, {
    method: "POST",
    body: JSON.stringify({ kind: input.kind, message: input.message }),
  }, allowAuthRecovery);
}

export async function loadProfessorItCardSuggestions(): Promise<ReadonlyArray<ProfessorItCardSuggestion>> {
  const response = await requestJson("/professorit/card-suggestions", { method: "GET" }, allowAuthRecovery);
  const suggestions = (response.value as { suggestions?: unknown } | null)?.suggestions;
  return Array.isArray(suggestions) ? suggestions as ReadonlyArray<ProfessorItCardSuggestion> : [];
}

export async function reviewProfessorItCardSuggestion(
  suggestionId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  await requestJson(`/professorit/card-suggestions/${suggestionId}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  }, allowAuthRecovery);
}

export async function updateProfessorItCardSuggestion(
  suggestionId: string,
  message: string,
): Promise<void> {
  await requestJson(`/professorit/card-suggestions/${suggestionId}/message`, {
    method: "POST",
    body: JSON.stringify({ message }),
  }, allowAuthRecovery);
}
