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
  if (title.includes("leetcode") || title.includes("力扣") || haystack.includes("leetcode") || title.includes("牛客") || haystack.includes("nowcoder")) {
    return { key: "game:leetcode", label: "刷题", mood: "学习中" };
  }
  if (title.includes("bilibili") || title.includes("哔哩哔哩") || haystack.includes("bilibili")) {
    return { key: "game:bilibili", label: "看视频", mood: "娱乐中" };
  }
  if (haystack.includes("chrome") || haystack.includes("msedge") || haystack.includes("firefox")) {
    return { key: "browse:web", label: "浏览网页", mood: "游历中" };
  }
  if (haystack.includes("yuanshen") || haystack.includes("genshin") || title.includes("原神")) {
    return { key: "game:genshin", label: "原神", mood: "游戏中" };
  }
  if (haystack.includes("wuthering") || haystack.includes("client-win64-shipping") || title.includes("鸣潮")) {
    return { key: "game:wuthering-waves", label: "鸣潮", mood: "游戏中" };
  }
  if (haystack.includes("starrail") || title.includes("星穹铁道")) {
    return { key: "game:star-rail", label: "星穹铁道", mood: "游戏中" };
  }
  if (haystack.includes("endfield") || title.includes("终末地")) {
    return { key: "game:end-field", label: "终末地", mood: "游戏中" };
  }
  if (haystack.includes("zenlesszonezero") || title.includes("绝区零")) {
    return { key: "game:zenless-zone-zero", label: "绝区零", mood: "游戏中" };
  }
  if (haystack.includes("mumu") || title.includes("mumu安卓设备") || title.includes("mumu模拟器")) {
    return { key: "game:mumu", label: "手机游戏", mood: "游戏中" };
  }
  if (title.includes("异环")) {
    return { key: "game:nte", label: "异环", mood: "游戏中" };
  }
  if (haystack.includes("arknights") || title.includes("明日方舟") || title.includes("arknights")) {
    return { key: "game:arknights", label: "明日方舟", mood: "游戏中" };
  }
  if (haystack.includes("wechat") || title.includes("微信")){
    return { key: "chatting", label: "聊天", mood: "聊天中" };
  }
  if (haystack.includes("deltaforce") || title.includes("三角洲行动")) {
    return { key: "game:delta-force", label: "三角洲行动", mood: "游戏中" };
  }
  if (haystack.includes("cs2") || title.includes("counter-strike 2") || title.includes("反恐精英2") || haystack.includes("csgo") || title.includes("反恐精英：全球攻势")) {
    return { key: "game:cs2", label: "CS", mood: "游戏中" };
  }
  if (haystack.includes("league of legends") || process.includes("leagueclient") || title.includes("league of legends") || title.includes("英雄联盟")) {
    return { key: "game:lol", label: "英雄联盟", mood: "游戏中" };
  }
  if (
    haystack.includes("cloudmusic") ||
    haystack.includes("spotify") ||
    haystack.includes("qqmusic") ||
    title.includes("网易云音乐") ||
    title.includes("qq音乐")
  ) {
    return { key: `music:${process || "player"}`, label: "听歌", mood: "听歌" };
  }
  if (haystack.includes("code") || haystack.includes("cursor") || title.includes("visual studio code") || title.includes("pycharm") || title.includes("idea") || title.includes("intellij"))  {
    return { key: "work:code", label: "写代码", mood: "专注" };
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
