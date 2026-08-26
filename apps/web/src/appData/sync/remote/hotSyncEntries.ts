import type { WorkspaceSchedulerSettings } from "../../../types";
import type {
  CardHotSyncEntry,
  HotSyncEntry,
  WorkspaceRemoteSyncInput,
} from "./types";

function findLastWorkspaceSettingsEntry(
  entries: ReadonlyArray<HotSyncEntry>,
): WorkspaceSchedulerSettings | null {
  let lastSettings: WorkspaceSchedulerSettings | null = null;

  for (const entry of entries) {
    if (entry.entityType === "workspace_scheduler_settings") {
      lastSettings = entry.payload;
    }
  }

  return lastSettings;
}

export function publishWorkspaceSettingsFromEntries(
  input: WorkspaceRemoteSyncInput,
  entries: ReadonlyArray<HotSyncEntry>,
): void {
  const lastSettings = findLastWorkspaceSettingsEntry(entries);
  if (lastSettings !== null) {
    input.publishWorkspaceSettings(input.workspaceId, lastSettings);
  }
}

function isCardHotSyncEntry(entry: HotSyncEntry): entry is CardHotSyncEntry {
  return entry.entityType === "card";
}

export async function doHotSyncEntriesAffectReviewSchedule(
  _workspaceId: string,
  entries: ReadonlyArray<HotSyncEntry>,
): Promise<boolean> {
  const cardEntries = entries.filter(isCardHotSyncEntry);
  if (cardEntries.length === 0) {
    return false;
  }

  // The review queue keeps complete Card objects, not only scheduling fields.
  // Rebuild it after every remote card upsert so changes to text, structured
  // Professor IT metadata and the LMS material link become visible immediately.
  // Without this invalidation IndexedDB contains the canonical card, while the
  // open review screen continues rendering its stale in-memory copy.
  return true;
}
