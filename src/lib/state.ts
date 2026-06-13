import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { normalizeActivityEntries } from "./activity";
import { defaultDataPath, defaultServerUrl } from "./config";
import { nowIso, todayKey } from "./date";
import type { AppState, FriendRating, Rank } from "../types";

export function applyUserIdToLocalData(state: AppState, userId: string): AppState {
  return {
    ...state,
    boots: state.boots.map((item) => ({ ...item, userId })),
    activities: state.activities.map((item) => ({ ...item, userId })),
    events: state.events.map((item) => ({ ...item, userId })),
    friendRatings: state.friendRatings.map((item) => (
      item.raterFriendId === state.user.id ? { ...item, raterFriendId: userId } : item
    ))
  };
}

export function initialState(): AppState {
  const userId = "local-neko";
  return {
    user: { id: userId, name: "Sunme", handle: "@dayneko" },
    settings: {
      serverUrl: defaultServerUrl,
      autoStart: false,
      silentRun: false,
      closeToTray: true,
      theme: "light",
      language: "zh-CN",
      fontSize: "large",
      accentColor: "#c9a5a5",
      dataPath: defaultDataPath,
      backgroundBrightness: 86,
      cardOpacity: 74,
      cardBlur: 18,
      cardShadow: 11,
      syncIntervalSeconds: 60,
      autoDiscoverServer: true,
      autoCheckUpdate: true,
      autoDownloadUpdate: true
    },
    dirtyQueue: [],
    boots: [],
    activities: [],
    events: [],
    friends: [],
    friendRequests: [],
    friendRatings: []
  };
}

export function migrateState(raw: string): AppState {
  const base = initialState();
  const parsed = JSON.parse(raw) as Partial<AppState> & {
    schedules?: Array<{ id: string; userId: string; title: string; kind: string; doneDates?: string[] }>;
    dailyRatings?: Array<{ id: string; userId: string; date: string; rank: Rank; comment: string; createdAt: string; updatedAt: string }>;
  };

  return {
    ...base,
    ...parsed,
    user: { ...base.user, ...(parsed.user ?? {}) },
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
    dirtyQueue: parsed.dirtyQueue ?? [],
    boots: (parsed.boots ?? []).map((boot) => ({ ...boot, updatedAt: boot.updatedAt ?? boot.startedAt })),
    activities: normalizeActivityEntries((parsed.activities ?? base.activities).map((activity) => ({
      ...activity,
      updatedAt: activity.updatedAt ?? activity.startedAt
    }))),
    events: (
      parsed.events ??
      (parsed.schedules ?? []).map((schedule) => ({
        id: schedule.id,
        userId: schedule.userId,
        title: schedule.title,
        description: "",
        date: todayKey(),
        repeatDaily: schedule.kind === "daily",
        completedDates: schedule.doneDates ?? [],
        evidence: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      }))
    ).map((event) => ({
      ...event,
      evidence: event.evidence.map((image) => ({
        ...image,
        dataUrl: image.filePath && !image.dataUrl.startsWith("data:") ? convertFileSrc(image.filePath) : image.dataUrl
      }))
    })),
    friends: (parsed.friends ?? base.friends).map((friend) => ({
      ...friend,
      updatedAt: friend.updatedAt ?? friend.lastSeen
    })),
    friendRequests: parsed.friendRequests ?? [],
    friendRatings:
      parsed.friendRatings ??
      (parsed.dailyRatings ?? []).map((rating): FriendRating => ({
        id: rating.id,
        targetUserId: rating.userId,
        raterFriendId: "mira",
        date: rating.date,
        rank: rating.rank,
        comment: rating.comment,
        eventIds: [],
        createdAt: rating.createdAt,
        updatedAt: rating.updatedAt
      }))
  };
}

export function loadState(): AppState {
  return initialState();
}

export async function loadStoredState(dataPath = ""): Promise<AppState | null> {
  try {
    const raw = await invoke<string | null>("load_local_state", { dataDir: dataPath });
    return raw ? migrateState(raw) : null;
  } catch {
    return null;
  }
}

function stateForPersistence(state: AppState): Partial<AppState> {
  const compactEvent = (event: AppState["events"][number]) => ({
    ...event,
    evidence: event.evidence.map((image) => ({
      ...image,
      dataUrl: image.filePath ? "" : image.dataUrl
    }))
  });

  return {
    ...state,
    boots: undefined,
    activities: undefined,
    events: undefined,
    friendRatings: undefined,
    dirtyQueue: state.dirtyQueue.map((record) => {
      if (record.kind !== "event" || typeof record.payload !== "object" || record.payload === null) return record;
      return { ...record, payload: compactEvent(record.payload as AppState["events"][number]) };
    })
  };
}

export function saveState(state: AppState) {
  const stateJson = JSON.stringify(stateForPersistence(state));
  const dataDir = state.settings.dataPath.trim();
  void invoke("save_local_state", {
    dataDir,
    stateJson
  }).catch(() => undefined);
  if (dataDir) {
    void invoke("save_local_state", {
      dataDir: "",
      stateJson
    }).catch(() => undefined);
  }
}

export function saveStatePointer(state: AppState) {
  const stateJson = JSON.stringify(stateForPersistence(state));
  void invoke("save_local_state", {
    dataDir: "",
    stateJson
  }).catch(() => undefined);
}
