import { useEffect, useState, type ReactElement } from "react";
import {
  loadProfessorItCardSuggestions,
  reviewProfessorItCardSuggestion,
  type ProfessorItCardSuggestion,
} from "../../api";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function CardSuggestionsScreen(): ReactElement {
  const [suggestions, setSuggestions] = useState<ReadonlyArray<ProfessorItCardSuggestion>>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setSuggestions(await loadProfessorItCardSuggestions());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить предложения.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function review(suggestionId: string, status: "accepted" | "rejected"): Promise<void> {
    setBusyId(suggestionId);
    setErrorMessage("");
    try {
      await reviewProfessorItCardSuggestion(suggestionId, status);
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
        <div className="settings-nav-list">
          {suggestions.map((suggestion) => (
            <article className="content-card" key={suggestion.suggestionId}>
              <p className="subtitle">{suggestion.status === "pending" ? "Ожидает решения" : suggestion.status === "accepted" ? "Принято" : "Отклонено"}</p>
              <h2 className="panel-subtitle">{suggestion.frontText}</h2>
              <p>{suggestion.kind === "error" ? "Сообщение об ошибке" : "Дополнение ответа"}</p>
              <p>{suggestion.message}</p>
              <p className="subtitle">Ученик: {suggestion.userId}</p>
              {suggestion.status === "pending" ? (
                <div className="feedback-dialog-actions">
                  <button className="ghost-btn" type="button" disabled={busyId === suggestion.suggestionId} onClick={() => void review(suggestion.suggestionId, "rejected")}>Отклонить</button>
                  <button className="primary-btn" type="button" disabled={busyId === suggestion.suggestionId} onClick={() => void review(suggestion.suggestionId, "accepted")}>Пометить принятым</button>
                </div>
              ) : null}
            </article>
          ))}
          {suggestions.length === 0 ? <p className="subtitle">Предложений пока нет.</p> : null}
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
