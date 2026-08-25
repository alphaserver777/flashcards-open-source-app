import { useEffect, useState, type ReactElement } from "react";
import {
  loadProfessorItCardSuggestions,
  loadProfessorItNearDuplicatePairs,
  reviewProfessorItCardSuggestion,
  updateProfessorItCardSuggestion,
  type ProfessorItCardSuggestion,
  type ProfessorItNearDuplicatePair,
} from "../../api";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function CardSuggestionsScreen(): ReactElement {
  const [suggestions, setSuggestions] = useState<ReadonlyArray<ProfessorItCardSuggestion>>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [duplicatePairs, setDuplicatePairs] = useState<ReadonlyArray<ProfessorItNearDuplicatePair>>([]);

  async function load(): Promise<void> {
    setIsLoading(true);
    try {
      const [loadedSuggestions, loadedDuplicatePairs] = await Promise.all([
        loadProfessorItCardSuggestions(),
        loadProfessorItNearDuplicatePairs(),
      ]);
      setSuggestions(loadedSuggestions);
      setDuplicatePairs(loadedDuplicatePairs);
      setDrafts(Object.fromEntries(loadedSuggestions.map((suggestion) => [suggestion.suggestionId, suggestion.message])));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить предложения.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSuggestion(suggestion: ProfessorItCardSuggestion): Promise<void> {
    const message = (drafts[suggestion.suggestionId] ?? suggestion.message).trim();
    if (message === "") {
      setErrorMessage("Текст предложения не может быть пустым.");
      return;
    }
    setBusyId(suggestion.suggestionId);
    setErrorMessage("");
    try {
      await updateProfessorItCardSuggestion(suggestion.suggestionId, message);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить правку.");
    } finally {
      setBusyId(null);
    }
  }

  async function review(suggestion: ProfessorItCardSuggestion, status: "accepted" | "rejected"): Promise<void> {
    const message = (drafts[suggestion.suggestionId] ?? suggestion.message).trim();
    if (message === "") {
      setErrorMessage("Текст предложения не может быть пустым.");
      return;
    }
    setBusyId(suggestion.suggestionId);
    setErrorMessage("");
    try {
      if (message !== suggestion.message) {
        await updateProfessorItCardSuggestion(suggestion.suggestionId, message);
      }
      await reviewProfessorItCardSuggestion(suggestion.suggestionId, status);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить решение.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsShell title="Предложения учеников" subtitle="Изменения не попадают в общие карточки без вашего решения." activeTab="workspace">
      {errorMessage === "" ? null : <p className="error-banner">{errorMessage}</p>}
      <SettingsGroup title={`Всего: ${suggestions.length}`}>
        <button className="ghost-btn" type="button" disabled={isLoading} onClick={() => void load()}>{isLoading ? "Обновление…" : "Обновить"}</button>
        <div className="settings-nav-list">
          {suggestions.map((suggestion) => (
            <article className="content-card" key={suggestion.suggestionId}>
              <p className="subtitle">{suggestion.status === "pending" ? "Ожидает решения" : suggestion.status === "accepted" ? "Принято" : "Отклонено"}</p>
              <h2 className="panel-subtitle">{suggestion.frontText}</h2>
              <p>{suggestion.kind === "error" ? "Сообщение об ошибке" : "Дополнение ответа"}</p>
              <textarea className="text-input" rows={6} value={drafts[suggestion.suggestionId] ?? suggestion.message} onChange={(event) => setDrafts((current) => ({ ...current, [suggestion.suggestionId]: event.target.value }))} />
              <p className="subtitle">Ученик: {suggestion.submitterDisplayName ?? suggestion.submitterEmail ?? suggestion.userId}</p>
              {suggestion.submitterDisplayName === null || suggestion.submitterEmail === null ? null : <p className="subtitle">{suggestion.submitterEmail}</p>}
              <div className="feedback-dialog-actions">
                <button className="ghost-btn" type="button" disabled={busyId === suggestion.suggestionId || (drafts[suggestion.suggestionId] ?? suggestion.message).trim() === suggestion.message} onClick={() => void saveSuggestion(suggestion)}>Сохранить правку</button>
                <button className="ghost-btn" type="button" disabled={busyId === suggestion.suggestionId} onClick={() => void review(suggestion, "rejected")}>Отклонить</button>
                <button className="primary-btn" type="button" disabled={busyId === suggestion.suggestionId} onClick={() => void review(suggestion, "accepted")}>Применить</button>
              </div>
            </article>
          ))}
          {suggestions.length === 0 ? <p className="subtitle">Предложений пока нет.</p> : null}
        </div>
      </SettingsGroup>
      <SettingsGroup title={`Похожие вопросы: ${duplicatePairs.length}`}>
        <p className="subtitle">Проверьте пары вручную: это подсказка для объединения, карточки автоматически не меняются.</p>
        <div className="settings-nav-list">
          {duplicatePairs.map((pair) => (
            <article className="content-card" key={`${pair.leftSharedCardId}:${pair.rightSharedCardId}`}>
              <p className="subtitle">Совпадение {pair.similarity}% · {pair.subject}</p>
              <p><strong>{pair.leftQuestion}</strong> <span className="subtitle">({pair.leftStatus})</span></p>
              <p><strong>{pair.rightQuestion}</strong> <span className="subtitle">({pair.rightStatus})</span></p>
            </article>
          ))}
          {duplicatePairs.length === 0 ? <p className="subtitle">Похожих вопросов не найдено.</p> : null}
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
