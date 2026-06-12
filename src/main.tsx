import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  CalendarCheck,
  Check,
  Clock3,
  Home,
  ImagePlus,
  MessageSquareText,
  Moon,
  Plus,
  Power,
  RefreshCw,
  Send,
  Settings,
  Star,
  Sun,
  TimerReset,
  Trash2,
  Trophy,
  Upload,
  UsersRound
} from "lucide-react";
import { TimeDashboard, TimePage } from "./components/TimeDashboard";
import { FloatingScrollbar, Metric, NavButton, PanelTitle, Toggle } from "./components/ui";
import { activityKey, buildPresenceStatus, classifyForegroundActivity, normalizeActivityEntries } from "./lib/activity";
import { accentOptions, pageOrder, rankScore, ranks } from "./lib/config";
import {
  dateInLast7Days,
  dateKeyInBeijing,
  fmtTime,
  isArchiveClosed,
  minutesBetween,
  nowIso,
  scheduleDateKey,
  todayKey,
  uid,
  yesterdayKey
} from "./lib/date";
import { applyUserIdToLocalData, loadState, saveState } from "./lib/state";
import {
  actOnFriendRequest,
  authDevice,
  fetchFriendBundle,
  fetchFriendDays,
  normalizeServerUrl,
  sendFriendRequest,
  syncChanges,
  syncPresence,
  testServer
} from "./lib/api";
import { compressImage } from "./lib/media";
import type {
  ActivityEntry,
  AppSettings,
  AppState,
  AutoActivity,
  BootEvent,
  CustomEvent,
  DirtyKind,
  DirtyRecord,
  EvidenceDraft,
  EvidenceImage,
  EvidenceSelection,
  ForegroundActivity,
  Friend,
  FriendDay,
  FriendRating,
  FriendRequest,
  Language,
  LeaderboardEntry,
  LeaderboardScope,
  Page,
  PresenceStatus,
  Rank,
  UserProfile
} from "./types";
import "./styles.css";

function isRecentlyOnline(value?: string) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 60_000;
}

function scoreToRank(score: number): Rank {
  if (score >= 94) return "SSS";
  if (score >= 84) return "S";
  if (score >= 72) return "A";
  if (score >= 58) return "B";
  return "C";
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const parsed = Number.parseInt(value, 16);
  if (Number.isNaN(parsed)) return "84, 214, 176";
  return `${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}`;
}

function canEditEvent(event: CustomEvent, activeDate: string) {
  return !isArchiveClosed(activeDate) && (event.repeatDaily || event.date === activeDate);
}

function scheduleDates(events: CustomEvent[], ratings: FriendRating[]) {
  const dates = new Set<string>([todayKey()]);
  events.forEach((event) => {
    dates.add(event.date);
    event.completedDates.forEach((date) => dates.add(date));
  });
  ratings.forEach((rating) => dates.add(rating.date));
  return Array.from(dates).sort((a, b) => b.localeCompare(a));
}

function eventsForDate(events: CustomEvent[], date: string) {
  const today = todayKey();
  return events.filter((event) => {
    if (date === today && event.repeatDaily) return true;
    if (event.date === date) return true;
    return event.completedDates.includes(date);
  });
}

function useTicker() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function buildLeaderboard(state: AppState, scope: LeaderboardScope): LeaderboardEntry[] {
  const ownRatings = state.friendRatings.filter((rating) => scope === "all" || dateInLast7Days(rating.date));
  const score = ownRatings.reduce((sum, rating) => sum + rankScore[rating.rank], 0);
  const completed = state.events.reduce((sum, event) => sum + event.completedDates.length, 0);
  const own: LeaderboardEntry = {
    userId: state.user.id,
    name: state.user.name,
    handle: state.user.handle,
    score,
    rank: scoreToRank(ownRatings.length ? score / ownRatings.length : 45),
    completed,
    ratedDays: ownRatings.length
  };
  const mock: LeaderboardEntry[] = [
    { userId: "mira", name: "Mira", handle: "@mira", score: scope === "7d" ? 548 : 1920, rank: "S", completed: 19, ratedDays: 22 },
    { userId: "aki", name: "Aki", handle: "@aki", score: scope === "7d" ? 392 : 1764, rank: "A", completed: 14, ratedDays: 21 },
    { userId: "nora", name: "Nora", handle: "@nora", score: scope === "7d" ? 674 : 2048, rank: "SSS", completed: 22, ratedDays: 24 }
  ];
  return [own, ...mock].sort((a, b) => b.score - a.score);
}

function App() {
  const appShellRef = React.useRef<HTMLElement>(null);
  const [state, setState] = React.useState<AppState>(loadState);
  const [page, setPage] = React.useState<Page>("home");
  const [activityText, setActivityText] = React.useState("正在规划 DayNeko");
  const [mood, setMood] = React.useState("清醒");
  const [newEventTitle, setNewEventTitle] = React.useState("");
  const [newEventRepeat, setNewEventRepeat] = React.useState(true);
  const [friendHandle, setFriendHandle] = React.useState("");
  const [friendRatingRank, setFriendRatingRank] = React.useState<Rank>("S");
  const [friendRatingComment, setFriendRatingComment] = React.useState("昨天完成度不错，节奏稳定。");
  const [selectedFriend, setSelectedFriend] = React.useState("");
  const [friendStatus, setFriendStatus] = React.useState("连接服务器后可以搜索并发送好友申请");
  const [friendDaysByUser, setFriendDaysByUser] = React.useState<Record<string, { items: FriendDay[]; nextCursor: string | null }>>({});
  const [friendDaysLoading, setFriendDaysLoading] = React.useState(false);
  const [leaderboardScope, setLeaderboardScope] = React.useState<LeaderboardScope>("7d");
  const [syncStatus, setSyncStatus] = React.useState("等待自动同步");
  const [serverStatus, setServerStatus] = React.useState("尚未测试");
  const [loginStatus, setLoginStatus] = React.useState("未登录服务器");
  const [presence, setPresence] = React.useState<PresenceStatus>(() => buildPresenceStatus("local-neko", null, null));
  const [evidenceSelection, setEvidenceSelection] = React.useState<EvidenceSelection | null>(null);
  const [evidenceDraft, setEvidenceDraft] = React.useState<EvidenceDraft | null>(null);
  const now = useTicker();

  const today = scheduleDateKey();
  const active = state.activities[0];
  const visibleEvents = state.events.filter((event) => event.repeatDaily || event.date === today);
  const doneCount = visibleEvents.filter((event) => event.completedDates.includes(today)).length;
  const activeDuration = active ? minutesBetween(active.startedAt, active.endedAt) : 0;
  const online = Boolean(active && !active.endedAt);
  const selectedFriendData = state.friends.find((friend) => friend.id === selectedFriend) ?? state.friends[0];
  const selectedFriendOnline = selectedFriendData ? isRecentlyOnline(selectedFriendData.lastSeen) : false;
  const selectedFriendForeground = selectedFriendData?.detail || selectedFriendData?.foregroundTitle || selectedFriendData?.foregroundProcess || "";
  const selectedFriendDays = selectedFriendData ? friendDaysByUser[selectedFriendData.id]?.items ?? [] : [];
  const selectedFriendNextCursor = selectedFriendData ? friendDaysByUser[selectedFriendData.id]?.nextCursor ?? null : null;
  const receivedRatings = state.friendRatings.filter((rating) => rating.targetUserId === state.user.id);
  const latestRating = receivedRatings[0];
  const cloudLoggedIn = Boolean(state.cloudSession);

  const markDirty = (kind: DirtyKind, id: string, payload: unknown): DirtyRecord => ({
    id: `${kind}:${id}`,
    kind,
    payload,
    changedAt: nowIso()
  });

  const patchState = (recipe: (draft: AppState) => AppState, dirty?: DirtyRecord[]) => {
    setState((prev) => {
      const next = recipe(prev);
      const deduped = new Map<string, DirtyRecord>();
      [...prev.dirtyQueue, ...(dirty ?? [])].forEach((record) => deduped.set(record.id, record));
      const finalState = { ...next, dirtyQueue: Array.from(deduped.values()) };
      saveState(finalState);
      return finalState;
    });
  };

  const refreshFriends = React.useCallback(async () => {
    if (!state.cloudSession) {
      setFriendStatus("请先登录服务器，再使用好友功能");
      return;
    }
    try {
      const result = await fetchFriendBundle(state.settings, state.user.id);
      setState((prev) => {
        const next = {
          ...prev,
          friends: result.friends,
          friendRequests: result.requests
        };
        saveState(next);
        return next;
      });
      setFriendStatus("好友状态已刷新");
    } catch {
      setFriendStatus("无法连接服务器，好友数据暂时保持本地缓存");
    }
  }, [state.cloudSession, state.settings, state.user.id]);

  const loadFriendDays = React.useCallback(async (friendId: string, mode: "replace" | "append" = "replace") => {
    if (!friendId || !state.cloudSession) return;
    setFriendDaysLoading(true);
    try {
      const cursor = mode === "append" ? friendDaysByUser[friendId]?.nextCursor : null;
      const result = await fetchFriendDays(state.settings, friendId, cursor);
      setFriendDaysByUser((prev) => ({
        ...prev,
        [friendId]: {
          items: mode === "append" ? [...(prev[friendId]?.items ?? []), ...result.items] : result.items,
          nextCursor: result.nextCursor
        }
      }));
    } catch {
      setFriendStatus("好友历史加载失败，稍后重试");
    } finally {
      setFriendDaysLoading(false);
    }
  }, [friendDaysByUser, state.cloudSession, state.settings]);

  React.useEffect(() => {
    if (!selectedFriend && state.friends[0]) setSelectedFriend(state.friends[0].id);
    if (selectedFriend && !state.friends.some((friend) => friend.id === selectedFriend)) {
      setSelectedFriend(state.friends[0]?.id ?? "");
    }
  }, [selectedFriend, state.friends]);

  React.useEffect(() => {
    if (selectedFriendData && !friendDaysByUser[selectedFriendData.id]) {
      void loadFriendDays(selectedFriendData.id);
    }
  }, [friendDaysByUser, loadFriendDays, selectedFriendData]);

  React.useEffect(() => {
    if (!state.cloudSession) return;
    const interval = window.setInterval(() => void refreshFriends(), 20000);
    return () => window.clearInterval(interval);
  }, [refreshFriends, state.cloudSession]);

  const runSync = React.useCallback(async () => {
    if (!state.cloudSession) {
      setSyncStatus("未登录服务器，仅保存在本地");
      return;
    }
    const changes = state.dirtyQueue;
    if (changes.length === 0) {
      setSyncStatus("正在刷新服务器状态...");
      await refreshFriends();
      if (selectedFriendData) await loadFriendDays(selectedFriendData.id);
      setSyncStatus("没有待同步更改");
      return;
    }
    setSyncStatus(`同步 ${changes.length} 条更改...`);
    try {
      const result = await syncChanges(state.settings, state.user, changes);
      setState((prev) => {
        const syncedIds = new Set(changes.map((change) => change.id));
        const next = {
          ...prev,
          dirtyQueue: prev.dirtyQueue.filter((change) => !syncedIds.has(change.id)),
          lastSyncedAt: nowIso()
        };
        saveState(next);
        return next;
      });
      await refreshFriends();
      if (selectedFriendData) await loadFriendDays(selectedFriendData.id);
      setSyncStatus(`已自动同步 ${result.records} 条`);
    } catch {
      setSyncStatus("服务器离线，保留增量队列");
    }
  }, [loadFriendDays, refreshFriends, selectedFriendData, state.cloudSession, state.dirtyQueue, state.settings, state.user]);

  React.useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.fontSize = state.settings.fontSize;
    document.documentElement.style.setProperty("--accent", state.settings.accentColor);
    document.documentElement.style.setProperty("--accent-rgb", hexToRgb(state.settings.accentColor));
    document.documentElement.style.setProperty("--bg-brightness", `${state.settings.backgroundBrightness}%`);
    document.documentElement.style.setProperty("--custom-bg", state.settings.background ? `url(${state.settings.background})` : "none");
  }, [state.settings.accentColor, state.settings.background, state.settings.backgroundBrightness, state.settings.fontSize, state.settings.theme]);

  React.useEffect(() => {
    void invoke("set_close_to_tray", { enabled: state.settings.closeToTray }).catch(() => undefined);
  }, [state.settings.closeToTray]);

  React.useEffect(() => {
    const boot: BootEvent = {
      id: uid(),
      userId: state.user.id,
      startedAt: nowIso(),
      device: navigator.userAgent.includes("Windows") ? "Windows desktop" : "Local device",
      updatedAt: nowIso()
    };
    patchState((prev) => ({ ...prev, boots: [boot, ...prev.boots].slice(0, 30) }), [markDirty("boot", boot.id, boot)]);
  }, []);

  React.useEffect(() => {
    const interval = window.setInterval(() => void runSync(), state.settings.syncIntervalSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [runSync, state.settings.syncIntervalSeconds]);

  React.useEffect(() => {
    setPresence((prev) => (prev.userId === state.user.id ? prev : { ...prev, id: `${state.user.id}:presence`, userId: state.user.id }));
  }, [state.user.id]);

  React.useEffect(() => {
    if (!state.cloudSession) return;
    void syncPresence(state.settings, state.user, presence).catch(() => undefined);
  }, [presence, state.cloudSession, state.settings, state.user]);

  const applyAutoActivity = React.useCallback((detected: AutoActivity | null) => {
    setState((prev) => {
      const current = prev.activities[0];
      if (!detected) {
        if (!current || current.endedAt || current.source !== "auto") return prev;
        const ended = { ...current, endedAt: nowIso(), updatedAt: nowIso() };
        const next = {
          ...prev,
          activities: normalizeActivityEntries([ended, ...prev.activities.slice(1)])
        };
        const dirtyQueue = [...prev.dirtyQueue, markDirty("activity", ended.id, ended)];
        const finalState = { ...next, dirtyQueue };
        saveState(finalState);
        return finalState;
      }

      if (current && !current.endedAt && current.source === "auto" && activityKey(current) === detected.label.toLowerCase()) {
        return prev;
      }

      const startedAt = nowIso();
      if (
        current &&
        current.source === "auto" &&
        current.endedAt &&
        activityKey(current) === detected.label.toLowerCase() &&
        new Date(startedAt).getTime() - new Date(current.endedAt).getTime() <= 10 * 60 * 1000
      ) {
        const merged = { ...current, endedAt: undefined, updatedAt: startedAt };
        const next = { ...prev, activities: [merged, ...prev.activities.slice(1)] };
        const finalState = { ...next, dirtyQueue: [...prev.dirtyQueue, markDirty("activity", merged.id, merged)] };
        saveState(finalState);
        return finalState;
      }

      const entry: ActivityEntry = {
        id: uid(),
        userId: prev.user.id,
        label: detected.label,
        mood: detected.mood,
        startedAt,
        source: "auto",
        updatedAt: startedAt
      };
      const closedActivities = prev.activities.map((item, index) =>
        index === 0 && !item.endedAt ? { ...item, endedAt: startedAt, updatedAt: startedAt } : item
      );
      const changed = closedActivities.filter((item, index) => index === 0 && prev.activities[index] !== item);
      const next = {
        ...prev,
        activities: normalizeActivityEntries([entry, ...closedActivities]).slice(0, 120)
      };
      const dirtyQueue = [
        ...prev.dirtyQueue,
        ...changed.map((item) => markDirty("activity", item.id, item)),
        markDirty("activity", entry.id, entry)
      ];
      const finalState = { ...next, dirtyQueue };
      saveState(finalState);
      return finalState;
    });
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const detect = async () => {
      try {
        const foreground = await invoke<ForegroundActivity>("get_foreground_activity");
        const detected = classifyForegroundActivity(foreground);
        if (!disposed) {
          setPresence(buildPresenceStatus(state.user.id, foreground, detected));
          applyAutoActivity(detected);
        }
      } catch {
        if (!disposed) {
          setPresence(buildPresenceStatus(state.user.id, { title: "", process: "" }, null));
          applyAutoActivity(null);
        }
      }
    };
    void detect();
    const interval = window.setInterval(() => void detect(), 20000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [applyAutoActivity, state.user.id]);

  const startActivity = () => {
    const startedAt = nowIso();
    const entry: ActivityEntry = {
      id: uid(),
      userId: state.user.id,
      label: activityText.trim() || "正在放空自己",
      mood,
      startedAt,
      source: "manual",
      updatedAt: startedAt
    };
    const closed = state.activities.map((item, index) =>
      index === 0 && !item.endedAt ? { ...item, endedAt: entry.startedAt, updatedAt: entry.startedAt } : item
    );
    const mergedActivities = normalizeActivityEntries([entry, ...closed]).slice(0, 80);
    const previousId = closed[0]?.id;
    const dirtyActivities = mergedActivities.filter((item) => item.id === entry.id || item.id === previousId);
    patchState(
      (prev) => ({
        ...prev,
        activities: mergedActivities
      }),
      dirtyActivities.map((item) => markDirty("activity", item.id, item))
    );
  };

  const addEvent = () => {
    if (!newEventTitle.trim()) return;
    const event: CustomEvent = {
      id: uid(),
      userId: state.user.id,
      title: newEventTitle.trim(),
      description: "",
      date: today,
      repeatDaily: newEventRepeat,
      completedDates: [],
      evidence: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    patchState((prev) => ({ ...prev, events: [event, ...prev.events] }), [markDirty("event", event.id, event)]);
    setNewEventTitle("");
  };

  const toggleEvent = (event: CustomEvent) => {
    if (!canEditEvent(event, today)) return;
    const nextEvent = {
      ...event,
      completedDates: event.completedDates.includes(today)
        ? event.completedDates.filter((date) => date !== today)
        : [...event.completedDates, today],
      updatedAt: nowIso()
    };
    patchState(
      (prev) => ({ ...prev, events: prev.events.map((item) => (item.id === event.id ? nextEvent : item)) }),
      [markDirty("event", nextEvent.id, nextEvent)]
    );
  };

  const uploadEvidence = async (event: CustomEvent, files: FileList | null) => {
    if (!canEditEvent(event, today)) return;
    const file = files?.[0];
    if (!file) return;
    const dataUrl = await compressImage(file);
    setEvidenceDraft({ eventId: event.id, dataUrl, name: file.name });
  };

  const confirmEvidenceUpload = () => {
    if (!evidenceDraft?.dataUrl) return;
    const event = state.events.find((item) => item.id === evidenceDraft.eventId);
    if (!event || !canEditEvent(event, today)) return;
    const evidence: EvidenceImage = {
      id: uid(),
      name: evidenceDraft.name,
      dataUrl: evidenceDraft.dataUrl,
      size: Math.round(evidenceDraft.dataUrl.length * 0.75),
      createdAt: nowIso()
    };
    const nextEvent = { ...event, evidence: [evidence, ...event.evidence].slice(0, 4), updatedAt: nowIso() };
    patchState(
      (prev) => ({ ...prev, events: prev.events.map((item) => (item.id === event.id ? nextEvent : item)) }),
      [markDirty("event", nextEvent.id, nextEvent)]
    );
    setEvidenceDraft(null);
  };

  const removeEvent = (event: CustomEvent) => {
    if (!canEditEvent(event, today)) return;
    patchState((prev) => ({ ...prev, events: prev.events.filter((item) => item.id !== event.id) }), [
      markDirty("event", event.id, { ...event, deleted: true, updatedAt: nowIso() })
    ]);
  };

  const loginToServer = async () => {
    setLoginStatus("正在使用本机设备登录...");
    setServerStatus("登录中...");
    try {
      const result = await authDevice(state.settings, state.user);
      setState((prev) => {
        const adopted = applyUserIdToLocalData(prev, result.user.id);
        const dirtyRecords = [
          markDirty("user", result.user.id, result.user),
          ...adopted.boots.map((item) => markDirty("boot", item.id, item)),
          ...adopted.activities.map((item) => markDirty("activity", item.id, item)),
          ...adopted.events.map((item) => markDirty("event", item.id, item)),
          ...adopted.friendRatings.map((item) => markDirty("friend-rating", item.id, item))
        ];
        const next = {
          ...adopted,
          user: result.user,
          cloudSession: {
            serverUrl: normalizeServerUrl(prev.settings.serverUrl),
            machineKey: result.machineKey,
            loggedInAt: nowIso()
          },
          dirtyQueue: dirtyRecords
        };
        saveState(next);
        return next;
      });
      setLoginStatus(result.status === "created" ? "已创建并登录本设备账号" : "已登录本设备账号");
      setServerStatus("已登录服务器");
      void refreshFriends();
    } catch {
      setLoginStatus("登录失败，请检查服务器地址");
      setServerStatus("登录失败");
    }
  };

  const addFriend = async () => {
    if (!state.cloudSession) {
      setFriendStatus("请先登录服务器，再发送好友申请");
      return;
    }
    const handle = friendHandle.trim().replace(/^@?/, "@");
    if (!handle) return;
    if (state.friends.some((friend) => friend.handle.toLowerCase() === handle.toLowerCase())) {
      setFriendStatus("你们已经是好友了");
      return;
    }
    if (
      state.friendRequests.some(
        (request) =>
          request.status === "pending" &&
          (request.toHandle.toLowerCase() === handle.toLowerCase() || request.fromHandle.toLowerCase() === handle.toLowerCase())
      )
    ) {
      setFriendStatus("这条好友申请还没处理，不能重复发送");
      return;
    }
    setFriendStatus("正在发送好友申请...");
    try {
      const result = await sendFriendRequest(state.settings, state.user, handle);
      patchState((prev) => ({ ...prev, friendRequests: [result.request, ...prev.friendRequests.filter((item) => item.id !== result.request.id)] }));
      setFriendHandle("");
      setFriendStatus("好友申请已发送，等待对方同意");
    } catch (error) {
      setFriendStatus(error instanceof Error ? error.message : "好友申请发送失败");
    }
  };

  const handleFriendRequest = async (requestId: string, action: "accept" | "reject") => {
    if (!state.cloudSession) {
      setFriendStatus("请先登录服务器，再处理好友申请");
      return;
    }
    setFriendStatus(action === "accept" ? "正在同意好友申请..." : "正在拒绝好友申请...");
    try {
      const result = await actOnFriendRequest(state.settings, state.user.id, requestId, action);
      patchState((prev) => ({
        ...prev,
        friendRequests: [result.request, ...prev.friendRequests.filter((item) => item.id !== result.request.id)]
      }));
      await refreshFriends();
    } catch {
      setFriendStatus("申请处理失败，请确认服务器连接正常");
    }
  };

  const addFriendRating = (date = yesterdayKey()) => {
    if (!isArchiveClosed(date) || !selectedFriendData) return;
    const rating: FriendRating = {
      id: `${state.user.id}:${selectedFriendData.id}:${date}`,
      targetUserId: selectedFriendData.id,
      raterFriendId: state.user.id,
      date,
      rank: friendRatingRank,
      comment: friendRatingComment.trim(),
      eventIds: state.events.filter((event) => event.completedDates.includes(date)).map((event) => event.id),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    patchState(
      (prev) => ({
        ...prev,
        friendRatings: [rating, ...prev.friendRatings.filter((item) => item.id !== rating.id)]
      }),
      [markDirty("friend-rating", rating.id, rating)]
    );
  };

  const updateSettings = async (nextSettings: AppSettings) => {
    patchState((prev) => ({ ...prev, settings: nextSettings }));
    void invoke("set_close_to_tray", { enabled: nextSettings.closeToTray }).catch(() => undefined);
    try {
      const mod = await import("@tauri-apps/plugin-autostart");
      if (nextSettings.autoStart) await mod.enable();
      else await mod.disable();
    } catch {
      // Browser preview does not have Tauri plugin APIs.
    }
  };

  const updateProfile = (user: UserProfile) => {
    patchState((prev) => ({ ...prev, user }), [markDirty("user", user.id, user)]);
  };

  const runServerTest = async () => {
    setServerStatus("测试中...");
    try {
      const result = await testServer(state.settings);
      const snapshot = state.cloudSession
        ? await fetch(`${normalizeServerUrl(state.settings.serverUrl)}/users/${state.user.id}/snapshot`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
        : null;
      if (state.cloudSession && (snapshot?.events?.length || snapshot?.friendRatings?.length)) {
        setState((prev) => {
          const next = {
            ...prev,
            events: snapshot.events?.length ? snapshot.events : prev.events,
            friendRatings: snapshot.friendRatings?.length ? snapshot.friendRatings : prev.friendRatings
          };
          saveState(next);
          return next;
        });
      }
      setServerStatus(result.status === "ok" ? "连接正常" : "服务器有响应");
    } catch {
      setServerStatus("连接失败");
    }
  };

  return (
    <main className="app-shell" ref={appShellRef}>
      <aside className="app-sidebar">
        <div className="brand">
          <div className="avatar brand-avatar">{state.user.avatar ? <img src={state.user.avatar} alt="" /> : "D"}</div>
          <div>
            <strong>DayNeko</strong>
            <span>{state.user.name} · {state.user.handle}</span>
          </div>
        </div>
        <nav
          className="nav-list"
          style={{
            "--nav-top": `${pageOrder.indexOf(page) * 56}px`,
            "--nav-left": `${pageOrder.indexOf(page) * 128}px`
          } as React.CSSProperties}
        >
          <NavButton active={page === "home"} icon={<Home size={18} />} label="首页" onClick={() => setPage("home")} />
          <NavButton active={page === "time"} icon={<Clock3 size={18} />} label="时间" onClick={() => setPage("time")} />
          <NavButton active={page === "events"} icon={<CalendarCheck size={18} />} label="日程" onClick={() => setPage("events")} />
          <NavButton active={page === "friends"} icon={<UsersRound size={18} />} label="好友" onClick={() => setPage("friends")} />
          <NavButton active={page === "leaderboard"} icon={<Trophy size={18} />} label="排行" onClick={() => setPage("leaderboard")} />
          <NavButton active={page === "settings"} icon={<Settings size={18} />} label="设置" onClick={() => setPage("settings")} />
        </nav>
        <button className="sync-button" onClick={() => void runSync()}>
          <RefreshCw size={16} />
          <span>{syncStatus}</span>
        </button>
      </aside>

      <section className="main-stage">
        {page === "home" && (
          <HomePage
            active={active}
            activeDuration={activeDuration}
            doneCount={doneCount}
            eventCount={visibleEvents.length}
            latestRating={latestRating}
            cloudLoggedIn={cloudLoggedIn}
            presence={presence}
            pendingFriendRequests={state.friendRequests.filter((request) => request.toUserId === state.user.id && request.status === "pending").length}
            pendingRatingDays={selectedFriendDays.filter((day) => isArchiveClosed(day.date) && !state.friendRatings.some((rating) => rating.targetUserId === selectedFriendData?.id && rating.date === day.date)).length}
            serverStatus={serverStatus}
            state={state}
            activityText={activityText}
            mood={mood}
            events={visibleEvents}
            onActivityText={setActivityText}
            onLogin={loginToServer}
            onMood={setMood}
            onStartActivity={startActivity}
            onToggleEvent={toggleEvent}
          />
        )}
        {page === "time" && <TimePage activities={state.activities} boots={state.boots} />}
        {page === "events" && (
          <EventsPage
            events={visibleEvents}
            allEvents={state.events}
            ratings={receivedRatings}
            newEventRepeat={newEventRepeat}
            newEventTitle={newEventTitle}
            today={today}
            onAddEvent={addEvent}
            onEvidence={uploadEvidence}
            onStartEvidence={(event) => setEvidenceDraft({ eventId: event.id, name: "pasted-image.jpg" })}
            onOpenEvidence={(event, index) => setEvidenceSelection({ eventId: event.id, index })}
            onNewEventRepeat={setNewEventRepeat}
            onNewEventTitle={setNewEventTitle}
            onRemoveEvent={removeEvent}
            onToggleEvent={toggleEvent}
          />
        )}
        {page === "friends" && (
          <FriendsPage
            friendHandle={friendHandle}
            friends={state.friends}
            friendRequests={state.friendRequests}
            friendStatus={friendStatus}
            friendDays={selectedFriendDays}
            friendDaysLoading={friendDaysLoading}
            friendNextCursor={selectedFriendNextCursor}
            ratings={state.friendRatings}
            currentUser={state.user}
            selectedFriend={selectedFriend}
            ratingRank={friendRatingRank}
            ratingComment={friendRatingComment}
            onAddFriend={addFriend}
            onAddRating={addFriendRating}
            onHandleRequest={handleFriendRequest}
            onFriendHandle={setFriendHandle}
            onLoadMoreDays={() => selectedFriendData && void loadFriendDays(selectedFriendData.id, "append")}
            onRatingComment={setFriendRatingComment}
            onRatingRank={setFriendRatingRank}
            onSelectFriend={setSelectedFriend}
          />
        )}
        {page === "leaderboard" && (
          <LeaderboardPage
            entries={buildLeaderboard(state, leaderboardScope)}
            scope={leaderboardScope}
            onScope={setLeaderboardScope}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            cloudLoggedIn={cloudLoggedIn}
            loginStatus={loginStatus}
            settings={state.settings}
            serverStatus={serverStatus}
            user={state.user}
            onLogin={loginToServer}
            onProfile={updateProfile}
            onSettings={updateSettings}
            onServerTest={runServerTest}
          />
        )}
      </section>

      <aside className="friend-rail">
        <div className="rail-header">
          <span>Friends Live</span>
          <strong>{state.friends.length}</strong>
        </div>
        <div className="friend-list compact">
          {state.friends.map((friend) => (
            <button
              className={`friend-item ${selectedFriend === friend.id ? "selected" : ""}`}
              key={friend.id}
              onClick={() => {
                setSelectedFriend(friend.id);
                setPage("friends");
              }}
            >
              <div className="avatar">{friend.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong className="friend-name-line">
                  <span className={isRecentlyOnline(friend.lastSeen) ? "presence-dot online" : "presence-dot offline"} />
                  {friend.name}
                </strong>
                <span>{friend.status}</span>
              </div>
            </button>
          ))}
        </div>
        {selectedFriendData && (
          <div className="rail-card">
            <small>正在干嘛</small>
            <strong>{selectedFriendData.status}</strong>
            {selectedFriendForeground && <p>前台：{selectedFriendForeground}</p>}
            <span>{selectedFriendOnline ? "在线" : "离线"} · {selectedFriendData.mood} · {fmtTime(selectedFriendData.lastSeen)}</span>
          </div>
        )}
      </aside>
      <EvidenceViewer
        events={state.events}
        selection={evidenceSelection}
        onClose={() => setEvidenceSelection(null)}
        onMove={(next) => setEvidenceSelection(next)}
      />
      <EvidenceUploadDialog
        draft={evidenceDraft}
        onClose={() => setEvidenceDraft(null)}
        onConfirm={confirmEvidenceUpload}
        onPasteImage={(dataUrl) =>
          setEvidenceDraft((draft) => ({
            eventId: draft?.eventId ?? "",
            name: draft?.name || "pasted-image.jpg",
            dataUrl
          }))
        }
      />
      <FloatingScrollbar targetRef={appShellRef} />
    </main>
  );
}

function HomePage(props: {
  active?: ActivityEntry;
  activeDuration: number;
  activityText: string;
  cloudLoggedIn: boolean;
  doneCount: number;
  eventCount: number;
  events: CustomEvent[];
  latestRating?: FriendRating;
  mood: string;
  presence: PresenceStatus;
  pendingFriendRequests: number;
  pendingRatingDays: number;
  serverStatus: string;
  state: AppState;
  onActivityText: (value: string) => void;
  onLogin: () => void | Promise<void>;
  onMood: (value: string) => void;
  onStartActivity: () => void;
  onToggleEvent: (event: CustomEvent) => void;
}) {
  const todos = [
    {
      id: "friend-requests",
      title: "处理好友申请",
      value: props.pendingFriendRequests,
      caption: props.pendingFriendRequests > 0 ? `${props.pendingFriendRequests} 个申请等待处理` : "暂时没有新的好友申请"
    },
    {
      id: "pending-ratings",
      title: "待评分日程",
      value: props.pendingRatingDays,
      caption: props.pendingRatingDays > 0 ? `${props.pendingRatingDays} 天好友日程可以补评分` : "没有待评分好友日程"
    }
  ];

  return (
    <div className="page-stack">
      <header className="page-hero">
        <span className="eyebrow">Auto sync · Delta only</span>
        <h1>当前服务器是：{normalizeServerUrl(props.state.settings.serverUrl)}</h1>
        <p>状态：{props.cloudLoggedIn ? props.serverStatus : "本地模式，登录服务器后才会同步和启用好友数据"}</p>
      </header>

      {!props.cloudLoggedIn && (
        <section className="workspace-panel cloud-login-panel">
          <div>
            <span className="section-kicker">Cloud Login</span>
            <h2>登录或注册本设备</h2>
            <p className="muted">服务器会根据本机设备标识分配账号；如果已经存在同一设备账号，会直接登录。</p>
          </div>
          <button className="primary-button" onClick={() => void props.onLogin()}>登录 / 注册本设备</button>
        </section>
      )}

      <div className="metric-row">
        <Metric icon={<Power />} label="本次启动" value={props.state.boots[0] ? fmtTime(props.state.boots[0].startedAt) : "刚刚"} />
        <Metric icon={<Activity />} label="当前状态" value={props.active?.mood ?? "未记录"} />
        <Metric icon={<CalendarCheck />} label="今日日程" value={`${props.doneCount}/${props.eventCount}`} />
        <Metric icon={<Star />} label="好友评分" value={props.latestRating?.rank ?? "暂无"} />
      </div>

      <section className="workspace-panel focus-panel">
        <div>
          <span className="section-kicker">Now</span>
          <div className="presence-line">
            <span className={props.presence.online ? "presence-dot online" : "presence-dot offline"} />
            <h2>{props.presence.label}</h2>
          </div>
          <p>{props.presence.detail ? `前台：${props.presence.detail}` : "自动检测会每 20 秒更新一次。"}</p>
        </div>
        <div className="activity-form">
          <input value={props.activityText} onChange={(event) => props.onActivityText(event.target.value)} />
          <select value={props.mood} onChange={(event) => props.onMood(event.target.value)}>
            <option>清醒</option>
            <option>专注</option>
            <option>高能</option>
            <option>放空</option>
            <option>低电量</option>
          </select>
          <button onClick={props.onStartActivity}>
            <Send size={16} />
            记录
          </button>
        </div>
      </section>

      <section className="workspace-panel">
        <PanelTitle label="Events" title="今日自定义日程" icon={<CalendarCheck size={20} />} />
        <EventList events={props.events.slice(0, 4)} today={scheduleDateKey()} onToggleEvent={props.onToggleEvent} />
      </section>

      <section className="workspace-panel todo-panel">
        <PanelTitle label="Next" title="推荐待办事项" icon={<TimerReset size={20} />} />
        <div className="todo-scroll">
          {todos.map((todo) => (
            <article className={todo.value > 0 ? "todo-card hot" : "todo-card"} key={todo.id}>
              <div>
                <strong>{todo.title}</strong>
                <span>{todo.caption}</span>
              </div>
              <b>{todo.value}</b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function EventsPage(props: {
  events: CustomEvent[];
  allEvents: CustomEvent[];
  ratings: FriendRating[];
  newEventRepeat: boolean;
  newEventTitle: string;
  today: string;
  onAddEvent: () => void;
  onEvidence: (event: CustomEvent, files: FileList | null) => void;
  onOpenEvidence: (event: CustomEvent, index: number) => void;
  onStartEvidence: (event: CustomEvent) => void;
  onNewEventRepeat: (value: boolean) => void;
  onNewEventTitle: (value: string) => void;
  onRemoveEvent: (event: CustomEvent) => void;
  onToggleEvent: (event: CustomEvent) => void;
}) {
  const dates = scheduleDates(props.allEvents, props.ratings);
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Custom Schedule</span>
          <h1>自定义日程</h1>
        </div>
        <div className="inline-form event-create">
          <input
            placeholder="添加一个自定义事件"
            value={props.newEventTitle}
            onChange={(event) => props.onNewEventTitle(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && props.onAddEvent()}
          />
          <Toggle checked={props.newEventRepeat} label="每日循环" onChange={props.onNewEventRepeat} compact />
          <button onClick={props.onAddEvent}>
            <Plus size={16} />
          </button>
        </div>
      </header>

      <section className="workspace-panel">
        <PanelTitle label="Schedule Logs" title="按天查看日程记录" icon={<CalendarCheck size={20} />} />
        <p className="muted">每天默认有一个今日待办集合；没有每日轮换时就是空集合。往日记录从上到下排列，并展示好友给自己的评分。</p>
        <div className="schedule-day-list">
          {dates.map((date) => {
            const events = eventsForDate(props.allEvents, date);
            const ratings = props.ratings.filter((rating) => rating.date === date);
            const isToday = date === props.today;
            return (
              <section className="schedule-day" key={date}>
                {ratings[0] && <div className={`rank-ghost rank-${ratings[0].rank}`}>{ratings[0].rank}</div>}
                <div className="schedule-day-head">
                  <div>
                    <strong>{isToday ? "今日待办" : date}</strong>
                    <span>{events.length} 个事件 · {ratings.length} 条好友评分</span>
                  </div>
                  {ratings[0] && <span className={`rank-badge rank-${ratings[0].rank}`}>{ratings[0].rank}</span>}
                </div>
                <div className="event-list rich">
                  {events.map((event) => {
                    const editable = canEditEvent(event, props.today) && isToday;
                    const done = event.completedDates.includes(date);
                    return (
                      <article className={`event-card ${done ? "done" : ""} ${editable ? "" : "locked"}`} key={`${date}-${event.id}`}>
                        <div className="event-main">
                          <button className="done-control" disabled={!editable} onClick={() => props.onToggleEvent(event)}>
                            <span>{done && <Check size={18} />}</span>
                            <strong>{done ? "已完成" : "待完成"}</strong>
                          </button>
                          <div>
                            <strong>{event.title}</strong>
                            <span>{event.repeatDaily ? "每日循环" : "当天临时"} · 证据 {event.evidence.length} {editable ? "" : "· 已锁定"}</span>
                          </div>
                        </div>
                        <div className="event-actions">
                          <button className={`icon-upload ${editable ? "" : "disabled"}`} disabled={!editable} onClick={() => props.onStartEvidence(event)}>
                            <ImagePlus size={16} />
                          </button>
                          <button disabled={!editable} onClick={() => props.onRemoveEvent(event)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {event.evidence.length > 0 && (
                          <div className="evidence-strip">
                            {event.evidence.map((image, index) => (
                              <button className="evidence-thumb" key={image.id} onClick={() => props.onOpenEvidence(event, index)}>
                                <img src={image.dataUrl} alt={image.name} />
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {events.length === 0 && <p className="empty">这一天没有日程事件。</p>}
                </div>
                {ratings.map((rating) => (
                  <article className="rating-card" key={rating.id}>
                    <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>
                    <div>
                      <strong>好友评分 · {rating.date}</strong>
                      <p>{rating.comment}</p>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function FriendsPage(props: {
  currentUser: UserProfile;
  friendHandle: string;
  friends: Friend[];
  friendRequests: FriendRequest[];
  friendStatus: string;
  friendDays: FriendDay[];
  friendDaysLoading: boolean;
  friendNextCursor: string | null;
  ratings: FriendRating[];
  selectedFriend: string;
  ratingRank: Rank;
  ratingComment: string;
  onAddFriend: () => void | Promise<void>;
  onAddRating: (date: string) => void;
  onHandleRequest: (requestId: string, action: "accept" | "reject") => void;
  onFriendHandle: (value: string) => void;
  onLoadMoreDays: () => void;
  onRatingComment: (value: string) => void;
  onRatingRank: (value: Rank) => void;
  onSelectFriend: (id: string) => void;
}) {
  const selected = props.friends.find((friend) => friend.id === props.selectedFriend) ?? props.friends[0];
  const selectedRatings = props.ratings.filter((rating) => rating.targetUserId === selected?.id);
  const [ratingDate, setRatingDate] = React.useState(yesterdayKey());
  const [friendTab, setFriendTab] = React.useState<"schedule" | "time">("schedule");
  const incomingRequests = props.friendRequests.filter((request) => request.toUserId === props.currentUser.id && request.status === "pending");
  const outgoingRequests = props.friendRequests.filter((request) => request.fromUserId === props.currentUser.id && request.status === "pending");
  const closedDays = props.friendDays.filter((day) => isArchiveClosed(day.date));
  const ratingDates = Array.from(new Set([ratingDate, ...closedDays.map((day) => day.date), ...selectedRatings.map((rating) => rating.date)])).filter(Boolean);
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Friends</span>
          <h1>好友</h1>
        </div>
        <div className="inline-form">
          <input
            placeholder="@handle 加好友"
            value={props.friendHandle}
            onChange={(event) => props.onFriendHandle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void props.onAddFriend();
            }}
          />
          <button onClick={() => void props.onAddFriend()}>
            <Plus size={16} />
          </button>
        </div>
      </header>

      <div className="friend-page-grid">
        <section className="workspace-panel friend-network-panel">
          <PanelTitle label="Network" title="好友与申请" icon={<UsersRound size={20} />} />
          <p className="muted">{props.friendStatus}</p>
          {incomingRequests.length > 0 && (
            <div className="request-list">
              <strong>待处理申请</strong>
              {incomingRequests.map((request) => (
                <article className="request-card" key={request.id}>
                  <div>
                    <span>{request.fromName}</span>
                    <small>{request.fromHandle}</small>
                  </div>
                  <button onClick={() => props.onHandleRequest(request.id, "reject")}>拒绝</button>
                  <button className="primary-button mini" onClick={() => props.onHandleRequest(request.id, "accept")}>同意</button>
                </article>
              ))}
            </div>
          )}
          {outgoingRequests.length > 0 && (
            <div className="request-list">
              <strong>已发送申请</strong>
              {outgoingRequests.map((request) => (
                <article className="request-card pending" key={request.id}>
                  <div>
                    <span>{request.toName}</span>
                    <small>{request.toHandle}</small>
                  </div>
                  <em>等待对方同意</em>
                </article>
              ))}
            </div>
          )}
          <div className="friend-list">
            {props.friends.map((friend) => (
              <button className={`friend-item ${props.selectedFriend === friend.id ? "selected" : ""}`} key={friend.id} onClick={() => props.onSelectFriend(friend.id)}>
                <div className="avatar">{friend.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong className="friend-name-line">
                    <span className={isRecentlyOnline(friend.lastSeen) ? "presence-dot online" : "presence-dot offline"} />
                    {friend.name}
                  </strong>
                  <span>{friend.status}</span>
                </div>
                <small>{friend.mood}</small>
              </button>
            ))}
            {props.friends.length === 0 && <p className="empty">还没有正式好友。搜索对方 handle 并发送申请，对方同意后才会出现在这里。</p>}
          </div>
        </section>

        <section className="workspace-panel friend-rating-panel">
          <div className={`rank-ghost rank-${props.ratingRank}`}>{props.ratingRank}</div>
          <PanelTitle label="Friend Rating" title="给好友评分" icon={<MessageSquareText size={20} />} />
          <p className="muted">按天给好友的自定义日程打包评分。只有已经封档的日期可以补评分或修改评分。</p>
          <div className="rank-row compact-ranks">
            {ranks.map((rank) => (
              <button className={`rank-pill rank-${rank} ${props.ratingRank === rank ? "active" : ""}`} key={rank} onClick={() => props.onRatingRank(rank)}>
                {rank}
              </button>
            ))}
          </div>
          <textarea value={props.ratingComment} onChange={(event) => props.onRatingComment(event.target.value)} />
          <label className="field">
            <span>评分日期</span>
            <select value={ratingDate} onChange={(event) => setRatingDate(event.target.value)}>
              {ratingDates.map((date) => (
                <option value={date} key={date}>{date}</option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={!selected || !isArchiveClosed(ratingDate)} onClick={() => props.onAddRating(ratingDate)}>
            {selectedRatings.some((rating) => rating.date === ratingDate) ? "修改评分" : "提交补评分"}
          </button>
          <div className="rating-feed">
            {selectedRatings.map((rating) => {
              return (
                <article className="rating-card" key={rating.id}>
                  <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>
                  <div>
                    <strong>{props.currentUser.name} 给 {selected?.name ?? "好友"} · {rating.date}</strong>
                    <p>{rating.comment}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className="workspace-panel friend-detail-panel">
        <div className="friend-detail-head">
          <PanelTitle label="Friend Detail" title={`${selected?.name ?? "选择好友"} 的记录`} icon={<CalendarCheck size={20} />} />
          <div className="segmented compact" style={{ "--seg-index": friendTab === "schedule" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
            <button className={friendTab === "schedule" ? "active" : ""} onClick={() => setFriendTab("schedule")}>日程</button>
            <button className={friendTab === "time" ? "active" : ""} onClick={() => setFriendTab("time")}>时长</button>
          </div>
        </div>
        {!selected && <p className="empty">选择一个好友后，可以按周查看对方的日程记录和每日时长。</p>}
        {selected && friendTab === "schedule" && (
          <div className="schedule-day-list">
            {props.friendDays.map((day) => {
              const rating = selectedRatings.find((item) => item.date === day.date) ?? day.ratings.find((item) => item.raterFriendId === props.currentUser.id);
              return (
                <section className="schedule-day" key={day.date}>
                  {rating && <div className={`rank-ghost rank-${rating.rank}`}>{rating.rank}</div>}
                  <div className="schedule-day-head">
                    <div>
                      <strong>{day.date}</strong>
                      <span>{day.events.length} 个事件 · {rating ? "已评分" : "未评分"}</span>
                    </div>
                    {rating && <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>}
                  </div>
                  <div className="event-list rich">
                    {day.events.map((event) => {
                      const done = event.completedDates.includes(day.date);
                      return (
                        <article className={`event-card ${done ? "done" : ""} locked`} key={event.id}>
                          <div className="event-main">
                            <span className={done ? "done-dot done" : "done-dot"}>{done && <Check size={14} />}</span>
                            <div>
                              <strong>{event.title}</strong>
                              <span>{done ? "已完成" : "未完成"} · 证据 {event.evidence.length}</span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {day.events.length === 0 && <p className="empty">这天没有同步到日程事件。</p>}
                  </div>
                  {!rating && isArchiveClosed(day.date) && <button className="primary-button subtle" onClick={() => setRatingDate(day.date)}>选择这天评分</button>}
                </section>
              );
            })}
            {props.friendDays.length === 0 && !props.friendDaysLoading && <p className="empty">还没有可展示的好友日程。好友需要先同步数据到服务器。</p>}
          </div>
        )}
        {selected && friendTab === "time" && (
          <div className="friend-time-list">
            <TimeDashboard
              activities={props.friendDays.flatMap((day) => day.activities)}
              boots={[]}
              embedded
              ownerLabel={selected.name}
              title={`${selected.name} 的时间地图`}
            />
            {props.friendDays.map((day) => (
              <article className="friend-time-card" key={day.date}>
                <div>
                  <strong>{day.date}</strong>
                  <span>{day.activities.length} 段活动</span>
                </div>
                <b>{Math.round(day.totalMinutes / 60 * 10) / 10}h</b>
                <div className="time-mini-bars">
                  {day.activities.slice(0, 8).map((activity) => (
                    <span
                      key={activity.id}
                      title={`${activity.label} · ${activity.minutes ?? 1} 分钟`}
                      style={{ height: `${Math.max(14, Math.min(86, activity.minutes ?? 1))}%` }}
                    />
                  ))}
                </div>
                {day.activities.length === 0 && <p className="empty">这天没有同步到活动时长。</p>}
              </article>
            ))}
            {props.friendDays.length === 0 && !props.friendDaysLoading && <p className="empty">还没有可展示的每日时长。</p>}
          </div>
        )}
        {selected && (
          <button className="primary-button subtle" disabled={props.friendDaysLoading || !props.friendNextCursor} onClick={props.onLoadMoreDays}>
            {props.friendDaysLoading ? "加载中..." : props.friendNextCursor ? "加载上一周" : "没有更早记录"}
          </button>
        )}
      </section>
    </div>
  );
}

function EvidenceViewer({
  events,
  onClose,
  onMove,
  selection
}: {
  events: CustomEvent[];
  onClose: () => void;
  onMove: (selection: EvidenceSelection) => void;
  selection: EvidenceSelection | null;
}) {
  if (!selection) return null;
  const event = events.find((item) => item.id === selection.eventId);
  const images = event?.evidence ?? [];
  const image = images[selection.index];
  if (!event || !image) return null;
  const move = (direction: -1 | 1) => {
    const next = (selection.index + direction + images.length) % images.length;
    onMove({ eventId: event.id, index: next });
  };
  return (
    <div className="lightbox" role="dialog" aria-modal="true">
      <button className="lightbox-backdrop" onClick={onClose} />
      <div className="lightbox-panel">
        <header>
          <div>
            <strong>{event.title}</strong>
            <span>{selection.index + 1} / {images.length} · {image.name}</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="lightbox-body">
          {images.length > 1 && <button onClick={() => move(-1)}>‹</button>}
          <img src={image.dataUrl} alt={image.name} />
          {images.length > 1 && <button onClick={() => move(1)}>›</button>}
        </div>
      </div>
    </div>
  );
}

function EvidenceUploadDialog({
  draft,
  onClose,
  onConfirm,
  onPasteImage
}: {
  draft: EvidenceDraft | null;
  onClose: () => void;
  onConfirm: () => void;
  onPasteImage: (dataUrl: string) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && draft.dataUrl) onConfirm();
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, onClose, onConfirm]);

  const onPaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    onPasteImage(await compressImage(file));
  };
  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onPasteImage(await compressImage(file));
  };

  if (!draft) return null;
  return (
    <div className="paste-dialog" role="dialog" aria-modal="true">
      <button className="lightbox-backdrop" onClick={onClose} />
      <div className="paste-panel" onPaste={onPaste} tabIndex={0}>
        <header>
          <div>
            <strong>上传证据</strong>
            <span>粘贴图片或选择图片后，按 Enter 才会上传</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <button
          className={`paste-zone ${draft.dataUrl ? "has-image" : ""}`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          {draft.dataUrl ? <img src={draft.dataUrl} alt={draft.name} /> : <span>在这里粘贴图片</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void onFile(event.currentTarget.files)}
          />
        </button>
        <footer>
          <span>{draft.name}</span>
          <label className="file-button compact-file">
            选择图片
            <input type="file" accept="image/*" onChange={(event) => void onFile(event.currentTarget.files)} />
          </label>
          <button className="primary-button" disabled={!draft.dataUrl} onClick={onConfirm}>确认上传</button>
        </footer>
      </div>
    </div>
  );
}

function LeaderboardPage({
  entries,
  scope,
  onScope
}: {
  entries: LeaderboardEntry[];
  scope: LeaderboardScope;
  onScope: (scope: LeaderboardScope) => void;
}) {
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Server Ranking</span>
          <h1>服务器排行榜</h1>
        </div>
        <div className="segmented" style={{ "--seg-index": scope === "7d" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
          <button className={scope === "7d" ? "active" : ""} onClick={() => onScope("7d")}>7 日榜</button>
          <button className={scope === "all" ? "active" : ""} onClick={() => onScope("all")}>总榜</button>
        </div>
      </header>
      <section className="workspace-panel leaderboard-panel">
        {entries.map((entry, index) => (
          <article className="leaderboard-row" key={entry.userId}>
            <span className="place">#{index + 1}</span>
            <div>
              <strong>{entry.name}</strong>
              <small>{entry.handle} · 完成 {entry.completed} · 评分天数 {entry.ratedDays}</small>
            </div>
            <span className={`rank-badge rank-${entry.rank}`}>{entry.rank}</span>
            <strong>{Math.round(entry.score)}</strong>
          </article>
        ))}
      </section>
    </div>
  );
}

function SettingsPage({
  cloudLoggedIn,
  loginStatus,
  settings,
  serverStatus,
  user,
  onLogin,
  onSettings,
  onProfile,
  onServerTest
}: {
  cloudLoggedIn: boolean;
  loginStatus: string;
  settings: AppSettings;
  serverStatus: string;
  user: UserProfile;
  onLogin: () => void | Promise<void>;
  onSettings: (settings: AppSettings) => void;
  onProfile: (user: UserProfile) => void;
  onServerTest: () => void;
}) {
  const update = (patch: Partial<AppSettings>) => void onSettings({ ...settings, ...patch });
  const updateUser = (patch: Partial<UserProfile>) => onProfile({ ...user, ...patch });
  const setAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    updateUser({ avatar: await compressImage(file, 512, 0.78) });
  };
  const setBackground = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    update({ background: await compressImage(file, 1800, 0.72) });
  };
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Settings</span>
          <h1>设置</h1>
        </div>
        <p>设置改成传统长条布局；左侧目录可以快速滑到对应模块。</p>
      </header>

      <section className="settings-layout">
        <nav className="settings-toc">
          <button onClick={() => jumpTo("settings-profile")}>个人资料</button>
          <button onClick={() => jumpTo("settings-server")}>服务器</button>
          <button onClick={() => jumpTo("settings-desktop")}>桌面行为</button>
          <button onClick={() => jumpTo("settings-look")}>外观语言</button>
        </nav>
        <div className="settings-list">
          <section className="workspace-panel settings-section" id="settings-profile">
            <PanelTitle label="Profile" title="头像和昵称" icon={<UsersRound size={20} />} />
            <div className="profile-edit">
              <div className="avatar large">{user.avatar ? <img src={user.avatar} alt="" /> : user.name.slice(0, 1).toUpperCase()}</div>
              <label className="file-button">
                <ImagePlus size={16} />
                更换头像
                <input type="file" accept="image/*" onChange={(event) => void setAvatar(event.currentTarget.files)} />
              </label>
            </div>
            <div className="settings-row">
              <label className="field">
                <span>昵称</span>
                <input value={user.name} onChange={(event) => updateUser({ name: event.target.value })} />
              </label>
              <label className="field">
                <span>账号标识</span>
                <input value={user.handle} readOnly />
              </label>
            </div>
            <p className="muted">
              {cloudLoggedIn ? `已登录：${user.handle}。账号标识由服务器按本机设备分配，不可更改。` : "当前是本地用户。选择服务器并登录后，服务器会按本机设备分配账号标识。"}
            </p>
            <label className="field">
              <span>自定义数据路径</span>
              <input
                placeholder="例如 D:\\DayNekoData"
                value={settings.dataPath}
                onChange={(event) => update({ dataPath: event.target.value })}
              />
            </label>
            <p className="muted">桌面端会把用户状态快照写入该目录下的 dayneko-state.json；网页预览仍会使用 localStorage 作为兜底。</p>
          </section>

          <section className="workspace-panel settings-section" id="settings-server">
            <PanelTitle label="Server" title="同步服务器" icon={<Upload size={20} />} />
            <label className="field">
              <span>服务器地址</span>
              <input value={settings.serverUrl} onChange={(event) => update({ serverUrl: event.target.value })} placeholder="http://127.0.0.1:8787" />
            </label>
            <div className="settings-row">
              <label className="field">
                <span>自动同步频率</span>
                <select value={settings.syncIntervalSeconds} onChange={(event) => update({ syncIntervalSeconds: Number(event.target.value) })}>
                  <option value={30}>30 秒</option>
                  <option value={60}>1 分钟</option>
                  <option value={300}>5 分钟</option>
                </select>
              </label>
              <button className="primary-button" onClick={onServerTest}>测试服务器</button>
            </div>
            <button className="primary-button" onClick={() => void onLogin()}>
              {cloudLoggedIn ? "重新登录本设备" : "登录 / 注册本设备"}
            </button>
            <p className="muted">登录状态：{loginStatus}</p>
            <p className="muted">状态：{serverStatus}。好友、同步和排行榜都走这个服务器地址。</p>
          </section>

          <section className="workspace-panel settings-section" id="settings-desktop">
            <PanelTitle label="Desktop" title="桌面行为" icon={<Power size={20} />} />
            <Toggle checked={settings.autoStart} label="开机自启动" onChange={(value) => update({ autoStart: value })} />
            <Toggle checked={settings.silentRun} label="静默运行" onChange={(value) => update({ silentRun: value })} />
            <Toggle checked={settings.closeToTray} label="关闭时最小化到托盘" onChange={(value) => update({ closeToTray: value })} />
          </section>

          <section className="workspace-panel settings-section" id="settings-look">
            <PanelTitle label="Look" title="外观和语言" icon={settings.theme === "dark" ? <Moon size={20} /> : <Sun size={20} />} />
            <div className="field">
              <span>主题</span>
              <div className="theme-segment" style={{ "--seg-index": settings.theme === "light" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
                <button className={settings.theme === "light" ? "active" : ""} onClick={() => update({ theme: "light" })}>浅色</button>
                <button className={settings.theme === "dark" ? "active" : ""} onClick={() => update({ theme: "dark" })}>深色</button>
              </div>
            </div>
            <div className="field">
              <span>字体大小</span>
              <div
                className="theme-segment three"
                style={{
                  "--seg-index": settings.fontSize === "small" ? 0 : settings.fontSize === "medium" ? 1 : 2,
                  "--seg-count": 3
                } as React.CSSProperties}
              >
                <button className={settings.fontSize === "small" ? "active" : ""} onClick={() => update({ fontSize: "small" })}>小</button>
                <button className={settings.fontSize === "medium" ? "active" : ""} onClick={() => update({ fontSize: "medium" })}>中</button>
                <button className={settings.fontSize === "large" ? "active" : ""} onClick={() => update({ fontSize: "large" })}>大</button>
              </div>
            </div>
            <div className="field">
              <span>强调色</span>
              <div className="accent-grid">
                {accentOptions.map((item) => (
                  <button
                    className={settings.accentColor.toLowerCase() === item.value.toLowerCase() ? "active" : ""}
                    key={item.value}
                    onClick={() => update({ accentColor: item.value })}
                  >
                    <span style={{ background: item.value }} />
                    {item.name}
                  </button>
                ))}
                <label>
                  <input type="color" value={settings.accentColor} onChange={(event) => update({ accentColor: event.target.value })} />
                  自定义
                </label>
              </div>
            </div>
            <div className="settings-row">
              <label className="field">
                <span>语言</span>
                <select value={settings.language} onChange={(event) => update({ language: event.target.value as Language })}>
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>背景亮度 {settings.backgroundBrightness}%</span>
              <div className="brightness-control">
                <small>暗</small>
                <input
                  className="brightness-range"
                  type="range"
                  min={35}
                  max={100}
                  value={settings.backgroundBrightness}
                  style={{ "--brightness-progress": `${((settings.backgroundBrightness - 35) / 65) * 100}%` } as React.CSSProperties}
                  onChange={(event) => update({ backgroundBrightness: Number(event.target.value) })}
                />
                <small>亮</small>
              </div>
            </label>
            <label className="file-button">
              <ImagePlus size={16} />
              自定义背景
              <input type="file" accept="image/*" onChange={(event) => void setBackground(event.currentTarget.files)} />
            </label>
          </section>

        </div>
      </section>
    </div>
  );
}

function EventList({ events, today, onToggleEvent }: { events: CustomEvent[]; today: string; onToggleEvent: (event: CustomEvent) => void }) {
  return (
    <div className="event-list">
      {events.map((event) => {
        const done = event.completedDates.includes(today);
        return (
          <button className={`schedule-item ${done ? "done" : ""}`} key={event.id} onClick={() => onToggleEvent(event)}>
            <span className="check-dot">{done && <Check size={14} />}</span>
            <span>{event.title}</span>
            <small>{event.repeatDaily ? "每日循环" : "临时"}</small>
          </button>
        );
      })}
      {events.length === 0 && <p className="empty">今天没有事件，可以添加一个。</p>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);






