import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  DeviceAuthResult,
  DirtyRecord,
  CustomEvent,
  Friend,
  FriendDay,
  FriendRating,
  FriendRequest,
  LeaderboardEntry,
  LeaderboardScope,
  PresenceStatus,
  UserProfile
} from "../types";
import { serverConfigUrl } from "./config";

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "http://127.0.0.1:8787";
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `http://${trimmed}`.replace(/\/$/, "");
}

export async function syncChanges(settings: AppSettings, user: UserProfile, changes: DirtyRecord[]) {
  if (changes.length === 0) return { records: 0 };
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/sync/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, changes })
  });
  if (!response.ok) throw new Error(`sync failed: ${response.status}`);
  return response.json() as Promise<{ records: number }>;
}

export async function syncPresence(settings: AppSettings, user: UserProfile, presence: PresenceStatus) {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/sync/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user,
      changes: [{
        id: `presence:${user.id}`,
        kind: "presence",
        payload: presence,
        changedAt: presence.updatedAt
      }]
    })
  });
  if (!response.ok) throw new Error(`presence sync failed: ${response.status}`);
  return response.json() as Promise<{ records: number }>;
}

export async function testServer(settings: AppSettings) {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/health`);
  if (!response.ok) throw new Error(`health failed: ${response.status}`);
  return response.json() as Promise<{ status: string }>;
}

export async function registerUser(settings: AppSettings, user: UserProfile) {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user)
  });
  if (!response.ok) throw new Error(`register failed: ${response.status}`);
  return response.json() as Promise<{ status: string }>;
}

async function getMachineKey() {
  try {
    return await invoke<string>("get_machine_key");
  } catch {
    const key = "dayneko-browser-machine-key";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = `dn-browser-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    localStorage.setItem(key, created);
    return created;
  }
}

export async function authDevice(settings: AppSettings, user: UserProfile) {
  const machineKey = await getMachineKey();
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machineKey, name: user.name, avatar: user.avatar })
  });
  if (!response.ok) throw new Error(`device auth failed: ${response.status}`);
  const result = await response.json() as DeviceAuthResult;
  return { ...result, machineKey };
}

export async function fetchFriendBundle(settings: AppSettings, userId: string) {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/users/${userId}/friends`);
  if (!response.ok) throw new Error(`friends failed: ${response.status}`);
  return response.json() as Promise<{ friends: Friend[]; requests: FriendRequest[] }>;
}

export async function sendFriendRequest(settings: AppSettings, user: UserProfile, toHandle: string) {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/friend-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromUserId: user.id, toHandle })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `request failed: ${response.status}`);
  }
  return response.json() as Promise<{ request: FriendRequest }>;
}

export async function actOnFriendRequest(settings: AppSettings, userId: string, requestId: string, action: "accept" | "reject") {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/friend-requests/${encodeURIComponent(requestId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId })
  });
  if (!response.ok) throw new Error(`request action failed: ${response.status}`);
  return response.json() as Promise<{ request: FriendRequest }>;
}

export async function fetchFriendDays(settings: AppSettings, friendId: string, cursor?: string | null, limit = 7) {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set("cursor", cursor);
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/users/${friendId}/schedule?${search.toString()}`);
  if (!response.ok) throw new Error(`friend days failed: ${response.status}`);
  return response.json() as Promise<{ items: FriendDay[]; nextCursor: string | null }>;
}

export async function fetchUserSnapshot(settings: AppSettings, userId: string) {
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/users/${userId}/snapshot`);
  if (!response.ok) throw new Error(`snapshot failed: ${response.status}`);
  return response.json() as Promise<{
    events?: CustomEvent[];
    friendRatings?: FriendRating[];
  }>;
}

export async function fetchLeaderboard(settings: AppSettings, scope: LeaderboardScope) {
  const search = new URLSearchParams({ scope });
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/leaderboard?${search.toString()}`);
  if (!response.ok) throw new Error(`leaderboard failed: ${response.status}`);
  const result = await response.json() as { entries: LeaderboardEntry[] };
  return result.entries;
}

export async function fetchServerConfig() {
  const response = await fetch(`${serverConfigUrl}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`server config failed: ${response.status}`);
  const config = await response.json() as { server?: string };
  if (!config.server?.trim()) throw new Error("server config is empty");
  const server = normalizeServerUrl(config.server);
  return server;
}
