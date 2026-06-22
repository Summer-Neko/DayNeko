import { invoke } from "@tauri-apps/api/core";
import type { ActivityEntry, BootEvent, CustomEvent, FriendRating } from "../types";

export type LocalRecordKind = "event" | "daily-template" | "activity" | "boot" | "friend-rating";

export type LocalDataSnapshot = {
  events: CustomEvent[];
  dailyTemplates: CustomEvent[];
  activities: ActivityEntry[];
  boots: BootEvent[];
  friendRatings: FriendRating[];
};

export type LocalFriendRatingData = {
  received: FriendRating[];
  given: FriendRating[];
};

async function loadLocalView<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const raw = await invoke<string>(command, args);
  return JSON.parse(raw) as T;
}

export async function loadHomeData(dataPath: string, date: string, userId: string): Promise<Pick<LocalDataSnapshot, "events" | "dailyTemplates" | "activities" | "boots" | "friendRatings">> {
  return loadLocalView("load_local_home_data", {
    dataDir: dataPath.trim(),
    date,
    userId
  });
}

export async function loadScheduleData(dataPath: string, userId: string, limit = 500): Promise<Pick<LocalDataSnapshot, "events" | "dailyTemplates" | "friendRatings">> {
  return loadLocalView("load_local_schedule_data", {
    dataDir: dataPath.trim(),
    userId,
    limit
  });
}

export async function loadScheduleMonthData(dataPath: string, userId: string, month: string): Promise<Pick<LocalDataSnapshot, "events" | "dailyTemplates" | "friendRatings">> {
  return loadLocalView("load_local_schedule_month_data", {
    dataDir: dataPath.trim(),
    userId,
    month
  });
}

export async function ensureLocalDailyInstances(dataPath: string, userId: string, date: string): Promise<CustomEvent[]> {
  return loadLocalView("ensure_local_daily_instances", {
    dataDir: dataPath.trim(),
    userId,
    date
  });
}

export async function loadTimeData(dataPath: string, limit = 1000): Promise<Pick<LocalDataSnapshot, "activities" | "boots">> {
  return loadLocalView("load_local_time_data", {
    dataDir: dataPath.trim(),
    limit
  });
}

export async function loadTimeDates(dataPath: string, limit = 5000): Promise<string[]> {
  return loadLocalView("load_local_time_dates", {
    dataDir: dataPath.trim(),
    limit
  });
}

export async function loadTimeDayData(dataPath: string, date: string, limit = 1000): Promise<Pick<LocalDataSnapshot, "activities" | "boots">> {
  return loadLocalView("load_local_time_day_data", {
    dataDir: dataPath.trim(),
    date,
    limit
  });
}

export async function loadFriendRatingData(dataPath: string, userId: string, limit = 500): Promise<LocalFriendRatingData> {
  return loadLocalView("load_local_friend_rating_data", {
    dataDir: dataPath.trim(),
    userId,
    limit
  });
}

export function saveLocalRecord<T extends { id: string }>(dataPath: string, kind: LocalRecordKind, record: T, userId: string) {
  return invoke("save_local_record", {
    dataDir: dataPath.trim(),
    kind,
    recordJson: JSON.stringify(record),
    userId
  }).catch(() => undefined);
}

export function deleteLocalRecord(dataPath: string, kind: LocalRecordKind, id: string) {
  return invoke("delete_local_record", {
    dataDir: dataPath.trim(),
    kind,
    id
  }).catch(() => undefined);
}

export function deleteEvidenceImage(dataPath: string, filePath?: string) {
  if (!filePath) return Promise.resolve();
  return invoke("delete_evidence_image", {
    dataDir: dataPath.trim(),
    filePath
  }).catch(() => undefined);
}
