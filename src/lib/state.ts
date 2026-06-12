import { invoke } from "@tauri-apps/api/core";
import { normalizeActivityEntries } from "./activity";
import { defaultDataPath, defaultServerUrl, legacyKeys, storageKey } from "./config";
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
      syncIntervalSeconds: 60
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
    events:
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
  const raw = localStorage.getItem(storageKey) ?? legacyKeys.map((key) => localStorage.getItem(key)).find(Boolean);
  if (!raw) return initialState();
  try {
    return migrateState(raw);
  } catch {
    return initialState();
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (state.settings.dataPath.trim()) {
    void invoke("save_state_to_data_dir", {
      dataDir: state.settings.dataPath.trim(),
      stateJson: JSON.stringify(state)
    }).catch(() => undefined);
  }
}
