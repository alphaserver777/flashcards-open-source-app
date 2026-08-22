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
}>;

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
  const suggestions = (response as unknown as { suggestions?: unknown }).suggestions;
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
