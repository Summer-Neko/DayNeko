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
  if (haystack.includes("star rail") || title.includes("星穹铁道")) {
    return { key: "game:star-rail", label: "正在玩星穹铁道", mood: "游戏中" };
  }
  if (haystack.includes("end field") || title.includes("终末地")) {
    return { key: "game:end-field", label: "正在玩终末地", mood: "游戏中" };
  }
  if (haystack.includes("zenlesszonezero") || title.includes("绝区零")) {
    return { key: "game:zenless-zone-zero", label: "正在玩绝区零", mood: "游戏中" };
  }
  if (haystack.includes("mumu") || title.includes("mumu安卓设备") || title.includes("mumu模拟器")) {
    return { key: "game:mumu", label: "正在玩手机游戏", mood: "游戏中" };
  }
  if (title.includes("异环")) {
    return { key: "game:nte", label: "正在玩异环", mood: "游戏中" };
  }
  if (haystack.includes("arknights") || title.includes("明日方舟") || title.includes("arknights")) {
    return { key: "game:arknights", label: "正在玩明日方舟", mood: "游戏中" };
  }
  if (haystack.includes("wechat") || title.includes("微信")){
    return { key: "chating", label: "正在聊天", mood: "聊天中" };
  }
  if (haystack.includes("deltaforce") || title.includes("三角洲行动")) {
    return { key: "game:delta-force", label: "正在玩三角洲行动", mood: "游戏中" };
  }
  if (
    haystack.includes("cloudmusic") ||
    haystack.includes("spotify") ||
    haystack.includes("qqmusic") ||
    title.includes("网易云音乐") ||
    title.includes("qq音乐")
  ) {
    return { key: `music:${process || "player"}`, label: "正在听歌", mood: "听歌" };
  }
  if (haystack.includes("code") || haystack.includes("cursor") || title.includes("visual studio code") || title.includes("pycharm") || title.includes("IDEA"))  {
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
    label: hasForeground ? "少女游历中" : "少女祈祷中",
    mood: hasForeground ? "大冒险" : "神神秘秘",
    detail: title || process,
    foregroundTitle: title,
    foregroundProcess: process,
    online: true,
    updatedAt: now
  };
}

export function mergeActivitySegments(activities: ActivityEntry[], maxGapMinutes = 30) {
  const sorted = [...activities].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const merged: ActivityEntry[] = [];
  const latestByKey = new Map<string, number>();
  sorted.forEach((activity) => {
    const key = activityKey(activity);
    const previousIndex = latestByKey.get(key);
    const previous = previousIndex === undefined ? undefined : merged[previousIndex];
    const previousEnd = previous?.endedAt ? new Date(previous.endedAt).getTime() : new Date(activity.startedAt).getTime();
    const activityEnd = activity.endedAt ? new Date(activity.endedAt).getTime() : Number.POSITIVE_INFINITY;
    if (
      previous &&
      activityKey(previous) === activityKey(activity) &&
      new Date(activity.startedAt).getTime() - previousEnd <= maxGapMinutes * 60 * 1000
    ) {
      merged[previousIndex!] = {
        ...previous,
        endedAt: previous.endedAt && activity.endedAt
          ? new Date(Math.max(new Date(previous.endedAt).getTime(), activityEnd)).toISOString()
          : undefined,
        updatedAt: activity.updatedAt
      };
      return;
    }
    merged.push(activity);
    latestByKey.set(key, merged.length - 1);
  });
  return merged;
}

export function normalizeActivityEntries(activities: ActivityEntry[]) {
  return mergeActivitySegments(activities, 30).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
