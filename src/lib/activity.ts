import type { ActivityEntry, AutoActivity, ForegroundActivity, PresenceStatus } from "../types";

const nowIso = () => new Date().toISOString();

export function activityKey(entry?: ActivityEntry) {
  return entry?.label.trim().toLowerCase() ?? "";
}

export function classifyForegroundActivity(activity: ForegroundActivity): AutoActivity | null {
  const process = activity.process.toLowerCase();
  const title = activity.title.toLowerCase();
  const haystack = `${process} ${title}`;

  if (!process && !title) return null;
  if (haystack.includes("yuanshen") || haystack.includes("genshin") || title.includes("原神")) {
    return { key: "game:genshin", label: "正在玩原神", mood: "游戏中" };
  }
  if (haystack.includes("wuthering") || haystack.includes("client-win64-shipping") || title.includes("鸣潮")) {
    return { key: "game:wuthering-waves", label: "正在玩鸣潮", mood: "游戏中" };
  }
  if (
    haystack.includes("cloudmusic") ||
    haystack.includes("spotify") ||
    haystack.includes("qqmusic") ||
    haystack.includes("music") ||
    title.includes("网易云音乐") ||
    title.includes("qq音乐")
  ) {
    return { key: `music:${process || "player"}`, label: "正在听歌", mood: "听歌" };
  }
  if (haystack.includes("code") || haystack.includes("cursor") || title.includes("visual studio code")) {
    return { key: "work:code", label: "正在写代码", mood: "专注" };
  }
  if (haystack.includes("chrome") || haystack.includes("msedge") || haystack.includes("firefox")) {
    return { key: "browse:web", label: "正在浏览网页", mood: "在线" };
  }
  return null;
}

export function buildPresenceStatus(userId: string, foreground: ForegroundActivity | null, detected: AutoActivity | null): PresenceStatus {
  const title = foreground?.title.trim() ?? "";
  const process = foreground?.process.trim() ?? "";
  const hasForeground = Boolean(title || process);
  const now = nowIso();
  if (detected) {
    return {
      id: `${userId}:presence`,
      userId,
      label: detected.label,
      mood: detected.mood,
      detail: title || process,
      foregroundTitle: title,
      foregroundProcess: process,
      online: true,
      updatedAt: now
    };
  }
  return {
    id: `${userId}:presence`,
    userId,
    label: hasForeground ? "空闲中" : "少女祈祷中",
    mood: hasForeground ? "空闲" : "未知",
    detail: title || process,
    foregroundTitle: title,
    foregroundProcess: process,
    online: true,
    updatedAt: now
  };
}

export function mergeActivitySegments(activities: ActivityEntry[], maxGapMinutes = 10) {
  const sorted = [...activities].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const merged: ActivityEntry[] = [];
  sorted.forEach((activity) => {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.label === activity.label &&
      previous.source === activity.source &&
      previous.endedAt &&
      new Date(activity.startedAt).getTime() - new Date(previous.endedAt).getTime() <= maxGapMinutes * 60 * 1000
    ) {
      merged[merged.length - 1] = {
        ...previous,
        endedAt: activity.endedAt,
        updatedAt: activity.updatedAt
      };
      return;
    }
    merged.push(activity);
  });
  return merged;
}

export function normalizeActivityEntries(activities: ActivityEntry[]) {
  return mergeActivitySegments(activities, 10).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
