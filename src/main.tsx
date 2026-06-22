import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  CalendarCheck,
  CloudDownload,
  Clock3,
  HardDrive,
  Home,
  RefreshCw,
  Settings,
  Trophy,
  UsersRound
} from "lucide-react";
import { TimePage } from "./components/TimeDashboard";
import { FloatingScrollbar, NavButton } from "./components/ui";
import { activityKey, buildPresenceStatus, classifyForegroundActivity, normalizeActivityEntries } from "./lib/activity";
import { appVersion, pageOrder } from "./lib/config";
import {
  dateKeyInBeijing,
  fmtTime,
  isArchiveClosed,
  monthKey,
  nowIso,
  scheduleDateKey,
  uid,
  yesterdayKey
} from "./lib/date";
import { applyUserIdToLocalData, loadState, loadStoredState, saveState, saveStatePointer } from "./lib/state";
import {
  deleteEvidenceImage,
  deleteLocalRecord,
  ensureLocalDailyInstances,
  loadFriendRatingData,
  loadHomeData,
  loadScheduleData,
  loadScheduleMonthData,
  loadTimeDates,
  loadTimeDayData,
  loadTimeData,
  saveLocalRecord,
  type LocalDataSnapshot
} from "./lib/localRecords";
import {
  ApiError,
  actOnFriendRequest,
  authDevice,
  fetchServerConfig,
  fetchFriendBundle,
  fetchFriendDays,
  fetchLeaderboard,
  fetchUserSnapshot,
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
  AvatarCropDraft,
  AutoActivity,
  BootEvent,
  CustomEvent,
  DirtyKind,
  DirtyRecord,
  EvidenceDraft,
  EvidenceImage,
  EvidenceSelection,
  ForegroundActivity,
  FriendDay,
  FriendRating,
  LeaderboardEntry,
  LeaderboardScope,
  Page,
  PresenceStatus,
  Rank,
  UpdateInfo,
  UserProfile
} from "./types";
import "./styles.css";
import { AppNotifications } from "./components/common/AppNotifications";
import { AvatarCropDialog } from "./components/common/AvatarCropDialog";
import { GlobalTooltip } from "./components/common/GlobalTooltip";
import { WindowChrome } from "./components/common/WindowChrome";
import { EvidenceUploadDialog } from "./components/evidence/EvidenceUploadDialog";
import { EvidenceViewer } from "./components/evidence/EvidenceViewer";
import { EventsPage } from "./pages/EventsPage";
import { FriendsPage } from "./pages/FriendsPage";
import { HomePage } from "./pages/HomePage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { buildLeaderboard } from "./lib/leaderboard";
import { hexToRgb } from "./lib/color";
import { canEditEvent, eventsForDate, isDailyTemplate } from "./lib/schedule";
import { isRecentlyOnline } from "./lib/presence";
import { fetchGitHubReleaseNotes } from "./lib/update";
import { installContextMenuGuard } from "./lib/contextMenu";
import { useAppNotifications, useNotifiedStatus } from "./hooks/useAppNotifications";
import { useTicker } from "./hooks/useTicker";

const skippedUpdateVersionKey = "dayneko-skipped-update-version";
const pendingUpdateInfoKey = "dayneko-pending-update-info";
const sharedAccentColorKey = "dayneko-accent-color";
const legacyDevDataPath = "F:\\Project\\DayNeko\\data";
const friendHomeRatingWindowDays = 7;

const emptyLocalData = (): LocalDataSnapshot => ({
  events: [],
  dailyTemplates: [],
  activities: [],
  boots: [],
  friendRatings: []
});

function deletedEvidenceIdsFromPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return [];
  const ids = (payload as { deletedEvidenceIds?: unknown }).deletedEvidenceIds;
  return Array.isArray(ids) ? ids.map((id) => String(id)).filter(Boolean) : [];
}

type StoredEvidenceImage = {
  filePath: string;
  mimeType: string;
  size: number;
};

type DataDirStatus = {
  hasDatabase: boolean;
  hasEvidence: boolean;
  isDaynekoData: boolean;
};

type DataPathConflictChoice = "use-existing" | "overwrite" | "cancel";

type CloudImportPrompt = {
  activities: number;
  boots: number;
  dailyTemplates: number;
  events: number;
  friendRatings: number;
};

async function serializeDirtyRecordForSync(record: DirtyRecord): Promise<DirtyRecord> {
  if (record.kind !== "event" || typeof record.payload !== "object" || record.payload === null) return record;
  const event = record.payload as CustomEvent;
  const evidence = await Promise.all(event.evidence.map(async (image) => {
    if (!image.filePath || image.dataUrl.startsWith("data:")) return image;
    const dataUrl = await invoke<string>("read_evidence_image_data_url", {
      filePath: image.filePath,
      mimeType: image.mimeType ?? ""
    }).catch(() => image.dataUrl);
    return { ...image, dataUrl };
  }));
  return { ...record, payload: { ...event, evidence } };
}

function isEmptyFriendRatingChange(record: DirtyRecord): boolean {
  if (record.kind !== "friend-rating" || typeof record.payload !== "object" || record.payload === null) return false;
  const rating = record.payload as Partial<FriendRating> & { deleted?: boolean };
  return !rating.deleted && (!Array.isArray(rating.eventIds) || rating.eventIds.length === 0);
}

function mergeDirtyRecord(previous: DirtyRecord | undefined, next: DirtyRecord) {
  if (!previous || previous.kind !== "event" || next.kind !== "event") return next;
  if (typeof previous.payload !== "object" || previous.payload === null || typeof next.payload !== "object" || next.payload === null) {
    return next;
  }
  const deletedEvidenceIds = Array.from(new Set([
    ...deletedEvidenceIdsFromPayload(previous.payload),
    ...deletedEvidenceIdsFromPayload(next.payload)
  ]));
  if (deletedEvidenceIds.length === 0) return next;
  return {
    ...next,
    payload: {
      ...(next.payload as Record<string, unknown>),
      deletedEvidenceIds
    }
  };
}

function duplicateEventConflict(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = error.detail;
  if (typeof detail === "object" && detail !== null && (detail as { code?: unknown }).code === "duplicate_event_title") {
    const title = String((detail as { title?: unknown }).title ?? "").trim().toLowerCase();
    const date = String((detail as { date?: unknown }).date ?? "").trim();
    if (title && date) return { title, date };
  }
  if (/duplicate event title/i.test(error.message)) return { title: "", date: "" };
  return null;
}

function App() {
  const appShellRef = React.useRef<HTMLElement>(null);
  const currentBootIdRef = React.useRef("");
  const currentBootRef = React.useRef<BootEvent | null>(null);
  const storageHydratedRef = React.useRef(false);
  const stateRef = React.useRef<AppState>(loadState());
  const notifications = useAppNotifications();
  const [state, setState] = React.useState<AppState>(() => stateRef.current);
  const [localData, setLocalData] = React.useState<LocalDataSnapshot>(emptyLocalData);
  const [page, setPage] = React.useState<Page>("home");
  const [friendHandle, setFriendHandle] = React.useState("");
  const [friendRatingRank, setFriendRatingRank] = React.useState<Rank>("S");
  const [friendRatingComment, setFriendRatingComment] = React.useState("完成度不错，继续加油。");
  const [selectedFriend, setSelectedFriend] = React.useState("");
  const [friendStatus, setFriendStatus] = useNotifiedStatus("连接服务器后可以搜索并发送好友申请", "好友", notifications.notify);
  const [friendDaysByUser, setFriendDaysByUser] = React.useState<Record<string, { items: FriendDay[]; nextCursor: string | null }>>({});
  const [friendDaysLoading, setFriendDaysLoading] = React.useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = React.useState<LeaderboardEntry[]>([]);
  const [leaderboardScope, setLeaderboardScope] = React.useState<LeaderboardScope>("7d");
  const [timeDates, setTimeDates] = React.useState<string[]>([]);
  const [scheduleMonth, setScheduleMonth] = React.useState(() => monthKey());
  const [dailyInstancesReadyKey, setDailyInstancesReadyKey] = React.useState("");
  const [syncStatus, setSyncStatus] = React.useState("等待自动同步");
  const [serverStatus, setServerStatus] = useNotifiedStatus("尚未测试", "服务器", notifications.notify);
  const [loginStatus, setLoginStatus] = useNotifiedStatus("未登录服务器", "登录", notifications.notify);
  const [presence, setPresence] = React.useState<PresenceStatus>(() => buildPresenceStatus("local-neko", null, null));
  const [evidenceSelection, setEvidenceSelection] = React.useState<EvidenceSelection | null>(null);
  const [evidenceDraft, setEvidenceDraft] = React.useState<EvidenceDraft | null>(null);
  const [avatarCrop, setAvatarCrop] = React.useState<AvatarCropDraft | null>(null);
  const [updateStatus, setUpdateStatus] = useNotifiedStatus("尚未检查更新", "更新", notifications.notify);
  const [loginBusy, setLoginBusy] = React.useState(false);
  const [serverTestBusy, setServerTestBusy] = React.useState(false);
  const [updateBusy, setUpdateBusy] = React.useState(false);
  const [dataPathConflict, setDataPathConflict] = React.useState<{ path: string } | null>(null);
  const dataPathConflictResolver = React.useRef<((choice: DataPathConflictChoice) => void) | null>(null);
  const [cloudImportPrompt, setCloudImportPrompt] = React.useState<CloudImportPrompt | null>(null);
  const cloudImportResolver = React.useRef<((importCloudData: boolean) => void) | null>(null);
  const runSyncRef = React.useRef<() => Promise<void>>(async () => undefined);
  const now = useTicker();

  const today = scheduleDateKey();
  const dailyInstancesKey = `${state.settings.dataPath}\n${state.user.id}\n${today}`;
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const visibleEvents = eventsForDate(localData.events, today);
  const doneCount = visibleEvents.filter((event) => event.completedDates.includes(today)).length;
  const selectedFriendData = state.friends.find((friend) => friend.id === selectedFriend) ?? state.friends[0];
  const selectedFriendOnline = selectedFriendData ? isRecentlyOnline(selectedFriendData.lastSeen) : false;
  const selectedFriendForeground = selectedFriendData?.detail || selectedFriendData?.foregroundTitle || selectedFriendData?.foregroundProcess || "";
  const selectedFriendDays = selectedFriendData ? friendDaysByUser[selectedFriendData.id]?.items ?? [] : [];
  const recentRatingFriendDays = selectedFriendDays
    .filter((day) => {
      const at = new Date(`${day.date}T00:00:00`).getTime();
      return at >= Date.now() - friendHomeRatingWindowDays * 86400000;
    })
    .slice(0, friendHomeRatingWindowDays);
  const visibleFriendEvents = selectedFriendDays.flatMap((day) => day.events);
  const selectedFriendNextCursor = selectedFriendData ? friendDaysByUser[selectedFriendData.id]?.nextCursor ?? null : null;
  const receivedRatings = localData.friendRatings.filter((rating) => rating.targetUserId === state.user.id);
  const latestRating = receivedRatings[0];
  const cloudLoggedIn = Boolean(state.cloudSession);
  const stateWithLocalData: AppState = { ...state, ...localData };

  const mergeLocalData = React.useCallback((snapshot: Partial<LocalDataSnapshot>) => {
    const currentBoot = currentBootRef.current;
    setLocalData((prev) => {
      const next = { ...prev, ...snapshot };
      if (currentBoot && next.boots && !next.boots.some((boot) => boot.id === currentBoot.id)) {
        next.boots = [currentBoot, ...next.boots];
      }
      return next;
    });
  }, []);

  const mergeTimeData = React.useCallback((snapshot: Pick<LocalDataSnapshot, "activities" | "boots">) => {
    setLocalData((prev) => {
      const activities = new Map(prev.activities.map((item) => [item.id, item]));
      const boots = new Map(prev.boots.map((item) => [item.id, item]));
      snapshot.activities.forEach((item) => activities.set(item.id, item));
      snapshot.boots.forEach((item) => boots.set(item.id, item));
      return {
        ...prev,
        activities: normalizeActivityEntries(Array.from(activities.values())).slice(0, 5000),
        boots: Array.from(boots.values()).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 5000)
      };
    });
  }, []);

  const changeScheduleMonth = React.useCallback((month: string) => {
    const currentMonth = monthKey(scheduleDateKey());
    setScheduleMonth(month > currentMonth ? currentMonth : month);
  }, []);

  const requestDataPathConflictChoice = React.useCallback((path: string) => (
    new Promise<DataPathConflictChoice>((resolve) => {
      dataPathConflictResolver.current = resolve;
      setDataPathConflict({ path });
    })
  ), []);

  const resolveDataPathConflictChoice = React.useCallback((choice: DataPathConflictChoice) => {
    dataPathConflictResolver.current?.(choice);
    dataPathConflictResolver.current = null;
    setDataPathConflict(null);
  }, []);

  const requestCloudImportChoice = React.useCallback((summary: CloudImportPrompt) => (
    new Promise<boolean>((resolve) => {
      cloudImportResolver.current = resolve;
      setCloudImportPrompt(summary);
    })
  ), []);

  const resolveCloudImportChoice = React.useCallback((importCloudData: boolean) => {
    cloudImportResolver.current?.(importCloudData);
    cloudImportResolver.current = null;
    setCloudImportPrompt(null);
  }, []);

  React.useEffect(() => {
    if (storageHydratedRef.current) return;
    storageHydratedRef.current = true;
    void loadStoredState(state.settings.dataPath).then((stored) => {
      if (!stored) {
        void invoke<string | null>("get_system_username")
          .then((systemName) => {
            const name = systemName?.trim();
            const initial = name ? { ...state, user: { ...state.user, name } } : state;
            setState(initial);
            setPresence((prev) => (prev.userId === initial.user.id ? prev : buildPresenceStatus(initial.user.id, null, null)));
            saveState(initial);
          })
          .catch(() => saveState(state));
        return;
      }
      setState(stored);
      setPresence((prev) => (prev.userId === stored.user.id ? prev : buildPresenceStatus(stored.user.id, null, null)));
    });
  }, []);

  React.useEffect(() => {
    if (!state.cloudSession) return;
    setLoginStatus("已登录本设备账号");
    setServerStatus(`当前服务器：${normalizeServerUrl(state.settings.serverUrl)}`);
  }, [setLoginStatus, setServerStatus, state.cloudSession, state.settings.serverUrl]);

  React.useEffect(() => {
    if (state.settings.dataPath.trim() && state.settings.dataPath !== legacyDevDataPath) return;
    void invoke<string>("get_default_data_dir")
      .then((dataPath) => {
        if (!dataPath.trim()) return;
        setState((prev) => {
          if (prev.settings.dataPath.trim() && prev.settings.dataPath !== legacyDevDataPath) return prev;
          const next = { ...prev, settings: { ...prev.settings, dataPath } };
          saveState(next);
          return next;
        });
      })
      .catch(() => undefined);
  }, [state.settings.dataPath]);

  React.useEffect(() => {
    if (page !== "home" || dailyInstancesReadyKey !== dailyInstancesKey) return;
    void Promise.all([
      loadHomeData(state.settings.dataPath, today, state.user.id),
      loadFriendRatingData(state.settings.dataPath, state.user.id, 200)
    ])
      .then(([homeData, ratingData]) => {
        const byId = new Map<string, FriendRating>();
        [...ratingData.received, ...ratingData.given].forEach((rating) => byId.set(rating.id, rating));
        mergeLocalData({ ...homeData, friendRatings: Array.from(byId.values()) });
      })
      .catch(() => undefined);
  }, [dailyInstancesKey, dailyInstancesReadyKey, mergeLocalData, page, state.settings.dataPath, state.user.id, today]);

  React.useEffect(() => {
    if (page !== "events" || dailyInstancesReadyKey !== dailyInstancesKey) return;
    void loadScheduleMonthData(state.settings.dataPath, state.user.id, scheduleMonth)
      .then(mergeLocalData)
      .catch(() => undefined);
  }, [dailyInstancesKey, dailyInstancesReadyKey, mergeLocalData, page, scheduleMonth, state.settings.dataPath, state.user.id]);

  React.useEffect(() => {
    if (page !== "time") return;
    void Promise.all([
      loadTimeData(state.settings.dataPath),
      loadTimeDates(state.settings.dataPath)
    ])
      .then(([timeData, dates]) => {
        mergeLocalData(timeData);
        setTimeDates(dates);
      })
      .catch(() => undefined);
  }, [mergeLocalData, page, state.settings.dataPath]);

  const loadTimeDate = React.useCallback((date: string) => {
    if (!date) return;
    void loadTimeDayData(state.settings.dataPath, date)
      .then(mergeTimeData)
      .catch(() => undefined);
  }, [mergeTimeData, state.settings.dataPath]);

  const refreshServerFriendRatings = React.useCallback(async () => {
    if (!state.cloudSession) return;
    const snapshot = await fetchUserSnapshot(state.settings, state.user.id);
    if (!snapshot.friendRatings) return;
    snapshot.friendRatings.forEach((rating) => void saveLocalRecord(state.settings.dataPath, "friend-rating", rating, state.user.id));
    setLocalData((prev) => ({ ...prev, friendRatings: snapshot.friendRatings ?? prev.friendRatings }));
  }, [state.cloudSession, state.settings, state.user.id]);

  React.useEffect(() => {
    if (page !== "friends") return;
    const load = async () => {
      if (state.cloudSession) {
        await refreshServerFriendRatings();
        return;
      }
      const result = await loadFriendRatingData(state.settings.dataPath, state.user.id);
      const byId = new Map<string, FriendRating>();
      [...result.received, ...result.given].forEach((rating) => byId.set(rating.id, rating));
      mergeLocalData({ friendRatings: Array.from(byId.values()) });
    };
    void load().catch(() => undefined);
  }, [mergeLocalData, page, refreshServerFriendRatings, state.cloudSession, state.settings.dataPath, state.user.id]);

  React.useEffect(() => {
    if (page !== "leaderboard") return;
    let disposed = false;
    const load = async () => {
      if (state.cloudSession) {
        try {
          const entries = await fetchLeaderboard(state.settings, leaderboardScope);
          if (!disposed) setLeaderboardEntries(entries);
          return;
        } catch {
          // Fall back to local data below.
        }
      }
      const scheduleData = await loadScheduleData(state.settings.dataPath, state.user.id).catch(() => null);
      if (disposed) return;
      if (scheduleData) {
        mergeLocalData(scheduleData);
        setLeaderboardEntries(buildLeaderboard({ ...state, ...scheduleData, activities: [], boots: [], friends: state.friends, friendRequests: state.friendRequests }, leaderboardScope));
      } else {
        setLeaderboardEntries(buildLeaderboard(stateWithLocalData, leaderboardScope));
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [leaderboardScope, mergeLocalData, page, state.cloudSession, state.friendRequests, state.friends, state.settings, state.user.id]);

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
      [...prev.dirtyQueue, ...(dirty ?? [])].forEach((record) => {
        deduped.set(record.id, mergeDirtyRecord(deduped.get(record.id), record));
      });
      const finalState = { ...next, dirtyQueue: Array.from(deduped.values()) };
      saveState(finalState);
      return finalState;
    });
  };

  const enqueueDirty = (dirty: DirtyRecord[]) => {
    patchState((prev) => prev, dirty);
  };

  React.useEffect(() => {
    let disposed = false;
    void ensureLocalDailyInstances(state.settings.dataPath, state.user.id, today)
      .then((created) => {
        if (disposed || created.length === 0) return;
        enqueueDirty(created.map((event) => markDirty("event", event.id, event)));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setDailyInstancesReadyKey(dailyInstancesKey);
      });
    return () => {
      disposed = true;
    };
  }, [dailyInstancesKey, state.settings.dataPath, state.user.id, today]);

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
      const result = await fetchFriendDays(state.settings, friendId, cursor, mode === "append" ? 7 : friendHomeRatingWindowDays);
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

  const discoverServer = React.useCallback(async () => {
    if (!state.settings.autoDiscoverServer) return null;
    const serverUrl = await fetchServerConfig();
    setState((prev) => {
      const normalized = normalizeServerUrl(serverUrl);
      const next = {
        ...prev,
        settings: { ...prev.settings, serverUrl: normalized }
      };
      saveState(next);
      return next;
    });
    setServerStatus("已更新服务器配置");
    return { ...state.settings, serverUrl: normalizeServerUrl(serverUrl) };
  }, [state.settings]);

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
    const interval = window.setInterval(() => {
      void refreshFriends();
      if (selectedFriendData) void loadFriendDays(selectedFriendData.id);
    }, 20000);
    return () => window.clearInterval(interval);
  }, [loadFriendDays, refreshFriends, selectedFriendData, state.cloudSession]);

  const runSync = React.useCallback(async () => {
    if (!state.cloudSession) {
      setSyncStatus("未登录服务器，仅保存在本地");
      return;
    }
    const invalidFriendRatingIds = new Set(state.dirtyQueue.filter(isEmptyFriendRatingChange).map((change) => change.id));
    if (invalidFriendRatingIds.size > 0) {
      setState((prev) => {
        const next = {
          ...prev,
          dirtyQueue: prev.dirtyQueue.filter((change) => !invalidFriendRatingIds.has(change.id))
        };
        saveState(next);
        return next;
      });
    }
    const changes = state.dirtyQueue.filter((change) => !invalidFriendRatingIds.has(change.id));
    if (changes.length === 0) {
      setSyncStatus("正在刷新服务器状态...");
      await refreshFriends();
      if (selectedFriendData) await loadFriendDays(selectedFriendData.id);
      setSyncStatus("没有待同步更改");
      return;
    }
    setSyncStatus(`同步 ${changes.length} 条更改...`);
    const syncPayloadChanges = await Promise.all(changes.map(serializeDirtyRecordForSync));
    const clearDirtyChanges = (ids: Set<string>) => {
      setState((prev) => {
        const next = {
          ...prev,
          dirtyQueue: prev.dirtyQueue.filter((change) => !ids.has(change.id)),
          lastSyncedAt: nowIso()
        };
        saveState(next);
        return next;
      });
    };
    const clearSyncedChanges = () => clearDirtyChanges(new Set(changes.map((change) => change.id)));
    const clearDuplicateEventConflict = (error: unknown) => {
      const conflict = duplicateEventConflict(error);
      if (!conflict) return false;
      const ids = new Set<string>();
      const localEventKeys = new Map<string, string>();
      localData.events.forEach((event) => {
        if ((event as CustomEvent & { deleted?: boolean }).deleted || isDailyTemplate(event)) return;
        const key = `${event.date}::${event.title.trim().toLowerCase()}`;
        if (!localEventKeys.has(key)) localEventKeys.set(key, event.id);
      });
      changes.forEach((change) => {
        if (change.kind !== "event" || typeof change.payload !== "object" || change.payload === null) return;
        const event = change.payload as CustomEvent & { deleted?: boolean };
        if (event.deleted || isDailyTemplate(event)) return;
        const key = `${event.date}::${event.title.trim().toLowerCase()}`;
        const matchesServerConflict = conflict.title ? event.title.trim().toLowerCase() === conflict.title && event.date === conflict.date : false;
        const conflictsWithLocalEvent = localEventKeys.has(key) && localEventKeys.get(key) !== event.id;
        if (matchesServerConflict || conflictsWithLocalEvent) ids.add(change.id);
      });
      if (ids.size === 0) return false;
      clearDirtyChanges(ids);
      const label = conflict.title && conflict.date ? `「${conflict.title}」(${conflict.date})` : "同日同名日程";
      setSyncStatus(`同步冲突：已跳过重复日程 ${label}`);
      notifications.notify(`服务器拒绝了重复日程 ${label}，已跳过对应增量记录。`, { title: "同步", kind: "warning" });
      return true;
    };
    try {
      const result = await syncChanges(state.settings, state.user, syncPayloadChanges);
      clearSyncedChanges();
      await refreshFriends();
      if (selectedFriendData) await loadFriendDays(selectedFriendData.id);
      setSyncStatus(`已自动同步 ${result.records} 条`);
    } catch (error) {
      if (clearDuplicateEventConflict(error)) return;
      try {
        setSyncStatus("同步失败，正在获取最新服务器...");
        const discovered = await discoverServer();
        if (!discovered) throw new Error("server discovery disabled");
        const result = await syncChanges(discovered, state.user, syncPayloadChanges);
        clearSyncedChanges();
        await refreshFriends();
        if (selectedFriendData) await loadFriendDays(selectedFriendData.id);
        setSyncStatus(`已切换到最新服务器并同步 ${result.records} 条`);
      } catch (retryError) {
        if (clearDuplicateEventConflict(retryError)) return;
        setSyncStatus("服务器离线，保留增量队列");
        notifications.notify("服务器离线，增量同步已保留到本地队列。", { title: "同步", kind: "warning" });
      }
    }
  }, [discoverServer, loadFriendDays, localData.events, notifications.notify, refreshFriends, selectedFriendData, state.cloudSession, state.dirtyQueue, state.settings, state.user]);

  React.useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  React.useEffect(() => installContextMenuGuard(), []);

  React.useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.fontSize = state.settings.fontSize;
    document.documentElement.style.setProperty("--accent", state.settings.accentColor);
    document.documentElement.style.setProperty("--accent-rgb", hexToRgb(state.settings.accentColor));
    localStorage.setItem(sharedAccentColorKey, state.settings.accentColor);
    document.documentElement.style.setProperty("--bg-brightness", `${state.settings.backgroundBrightness}%`);
    document.documentElement.style.setProperty("--card-opacity", `${state.settings.cardOpacity / 100}`);
    document.documentElement.style.setProperty("--card-strong-opacity", `${Math.min(0.98, (state.settings.cardOpacity + 16) / 100)}`);
    document.documentElement.style.setProperty("--card-blur", `${state.settings.cardBlur}px`);
    document.documentElement.style.setProperty("--card-shadow-alpha", `${state.settings.cardShadow / 100}`);
    document.documentElement.style.setProperty("--custom-bg", state.settings.background ? `url(${state.settings.background})` : "none");
  }, [
    state.settings.accentColor,
    state.settings.background,
    state.settings.backgroundBrightness,
    state.settings.cardBlur,
    state.settings.cardOpacity,
    state.settings.cardShadow,
    state.settings.fontSize,
    state.settings.theme
  ]);

  React.useEffect(() => {
    void invoke("set_close_to_tray", { enabled: state.settings.closeToTray }).catch(() => undefined);
  }, [state.settings.closeToTray]);

  React.useEffect(() => {
    const startedAt = nowIso();
    const currentState = stateRef.current;
    const boot: BootEvent = {
      id: uid(),
      userId: currentState.user.id,
      date: scheduleDateKey(),
      startedAt,
      endedAt: startedAt,
      device: navigator.userAgent.includes("Windows") ? "Windows desktop" : "Local device",
      updatedAt: startedAt
    };
    currentBootIdRef.current = boot.id;
    currentBootRef.current = boot;
    setLocalData((prev) => {
      const closedBoots = prev.boots.map((item) => {
        if (item.endedAt) return item;
        const endedAt = item.updatedAt || item.startedAt;
        return { ...item, date: item.date ?? scheduleDateKey(), endedAt, updatedAt: endedAt };
      });
      const changedBoots = closedBoots.filter((item, index) => prev.boots[index] !== item);
      [boot, ...changedBoots].forEach((item) => void saveLocalRecord(currentState.settings.dataPath, "boot", item, currentState.user.id));
      enqueueDirty([...changedBoots.map((item) => markDirty("boot", item.id, item)), markDirty("boot", boot.id, boot)]);
      return { ...prev, boots: [boot, ...closedBoots].slice(0, 300) };
    });
  }, []);

  React.useEffect(() => {
    const touchBoot = (ended = false) => {
      const bootId = currentBootIdRef.current;
      if (!bootId) return;
      setLocalData((prev) => {
        const currentState = stateRef.current;
        const timestamp = nowIso();
        let changedBoot: BootEvent | null = null;
        const boots = prev.boots.map((item) => {
          if (item.id !== bootId) return item;
          changedBoot = { ...item, date: item.date ?? scheduleDateKey(), updatedAt: timestamp, endedAt: timestamp };
          currentBootRef.current = changedBoot;
          return changedBoot;
        });
        if (!changedBoot) return prev;
        void saveLocalRecord(currentState.settings.dataPath, "boot", changedBoot, currentState.user.id);
        enqueueDirty([markDirty("boot", bootId, changedBoot)]);
        return { ...prev, boots };
      });
    };
    const interval = window.setInterval(() => touchBoot(false), 60_000);
    const beforeUnload = () => touchBoot(true);
    window.addEventListener("beforeunload", beforeUnload);
    const unlistenPromise = (() => {
      try {
        return getCurrentWebviewWindow().onCloseRequested(() => touchBoot(true)).catch(() => null);
      } catch {
        return Promise.resolve(null);
      }
    })();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", beforeUnload);
      void unlistenPromise.then((unlisten) => unlisten?.());
      touchBoot(true);
    };
  }, []);

  React.useEffect(() => {
    const interval = window.setInterval(() => void runSyncRef.current(), state.settings.syncIntervalSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [state.settings.syncIntervalSeconds]);

  React.useEffect(() => {
    setPresence((prev) => (prev.userId === state.user.id ? prev : { ...prev, id: `${state.user.id}:presence`, userId: state.user.id }));
  }, [state.user.id]);

  React.useEffect(() => {
    if (!state.cloudSession) return;
    void syncPresence(state.settings, state.user, presence).catch(() => undefined);
  }, [presence, state.cloudSession, state.settings, state.user]);

  const applyAutoActivity = React.useCallback((detected: AutoActivity | null) => {
    setLocalData((prev) => {
      const currentState = stateRef.current;
      const now = nowIso();
      const nowTime = new Date(now).getTime();
      const staleOpen = prev.activities
        .filter((item) => {
          if (item.endedAt || item.source !== "auto") return false;
          const updatedTime = new Date(item.updatedAt || item.startedAt).getTime();
          return Number.isFinite(updatedTime) && nowTime - updatedTime > 30 * 60 * 1000;
        })
        .map((item) => {
          const endedAt = item.updatedAt || item.startedAt;
          return { ...item, date: item.date ?? scheduleDateKey(), endedAt, updatedAt: endedAt };
        });
      const staleIds = new Set(staleOpen.map((item) => item.id));
      const baseActivities = staleIds.size > 0
        ? prev.activities.map((item) => staleOpen.find((changed) => changed.id === item.id) ?? item)
        : prev.activities;
      if (!detected) {
        const timestamp = now;
        const changed = baseActivities.filter((item) => !item.endedAt && item.source === "auto").map((item) => ({
          ...item,
          date: item.date ?? scheduleDateKey(),
          endedAt: timestamp,
          updatedAt: timestamp
        }));
        const allChanged = [...staleOpen, ...changed];
        if (allChanged.length === 0) return prev;
        allChanged.forEach((item) => void saveLocalRecord(currentState.settings.dataPath, "activity", item, currentState.user.id));
        enqueueDirty(allChanged.map((item) => markDirty("activity", item.id, item)));
        const changedById = new Map(allChanged.map((item) => [item.id, item]));
        return {
          ...prev,
          activities: normalizeActivityEntries(prev.activities.map((item) => changedById.get(item.id) ?? item)).slice(0, 1000)
        };
      }

      const detectedKey = detected.label.trim().toLowerCase();
      const openSame = baseActivities.find((item) => !item.endedAt && item.source === "auto" && activityKey(item) === detectedKey);
      const closeOtherOpenActivities = (keepId?: string) => baseActivities
        .filter((item) => item.id !== keepId && !item.endedAt && item.source === "auto")
        .map((item) => {
          const endedAt = item.updatedAt || item.startedAt;
          return { ...item, date: item.date ?? scheduleDateKey(), endedAt, updatedAt: endedAt };
        });
      if (openSame) {
        const timestamp = now;
        const closedOthers = closeOtherOpenActivities(openSame.id);
        if (new Date(timestamp).getTime() - new Date(openSame.updatedAt || openSame.startedAt).getTime() >= 60_000) {
          const touched = { ...openSame, date: openSame.date ?? scheduleDateKey(), updatedAt: timestamp };
          const allChanged = [...staleOpen, touched, ...closedOthers];
          allChanged.forEach((item) => void saveLocalRecord(currentState.settings.dataPath, "activity", item, currentState.user.id));
          enqueueDirty(allChanged.map((item) => markDirty("activity", item.id, item)));
          const changedById = new Map(allChanged.map((item) => [item.id, item]));
          return {
            ...prev,
            activities: normalizeActivityEntries(prev.activities.map((item) => changedById.get(item.id) ?? item)).slice(0, 1000)
          };
        }
        const allChanged = [...staleOpen, ...closedOthers];
        if (allChanged.length === 0) return prev;
        allChanged.forEach((item) => void saveLocalRecord(currentState.settings.dataPath, "activity", item, currentState.user.id));
        enqueueDirty(allChanged.map((item) => markDirty("activity", item.id, item)));
        const changedById = new Map(allChanged.map((item) => [item.id, item]));
        return {
          ...prev,
          activities: normalizeActivityEntries(prev.activities.map((item) => changedById.get(item.id) ?? item)).slice(0, 1000)
        };
      }

      const startedAt = now;
      const latestClosedSame = baseActivities.find((item) =>
        item.source === "auto" &&
        item.endedAt &&
        activityKey(item) === detectedKey
      );
      if (
        latestClosedSame &&
        new Date(startedAt).getTime() - new Date(latestClosedSame.endedAt!).getTime() <= 30 * 60 * 1000
      ) {
        const closedOthers = closeOtherOpenActivities(latestClosedSame.id);
        const merged = { ...latestClosedSame, date: latestClosedSame.date ?? scheduleDateKey(), endedAt: undefined, updatedAt: startedAt };
        const allChanged = [...staleOpen, merged, ...closedOthers];
        allChanged.forEach((item) => void saveLocalRecord(currentState.settings.dataPath, "activity", item, currentState.user.id));
        enqueueDirty(allChanged.map((item) => markDirty("activity", item.id, item)));
        const changedById = new Map(allChanged.map((item) => [item.id, item]));
        return {
          ...prev,
          activities: normalizeActivityEntries(prev.activities.map((item) => changedById.get(item.id) ?? item)).slice(0, 1000)
        };
      }

      const entry: ActivityEntry = {
        id: uid(),
        userId: currentState.user.id,
        label: detected.label,
        mood: detected.mood,
        date: scheduleDateKey(),
        startedAt,
        source: "auto",
        updatedAt: startedAt
      };
      const closedOthers = closeOtherOpenActivities(entry.id);
      const allChanged = [...staleOpen, entry, ...closedOthers];
      const changedById = new Map(allChanged.map((item) => [item.id, item]));
      const next = {
        ...prev,
        activities: normalizeActivityEntries([entry, ...prev.activities.map((item) => changedById.get(item.id) ?? item)]).slice(0, 1000)
      };
      allChanged.forEach((item) => void saveLocalRecord(currentState.settings.dataPath, "activity", item, currentState.user.id));
      enqueueDirty(allChanged.map((item) => markDirty("activity", item.id, item)));
      return next;
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

  const addEvent = (rawTitle: string, repeatDaily: boolean) => {
    const title = rawTitle.trim();
    if (!title) return false;
    const duplicateToday = eventsForDate(localData.events, today).some((event) => event.title.trim().toLowerCase() === title.toLowerCase());
    if (duplicateToday) {
      notifications.notify(`今天已经有「${title}」了，不能重复添加同名待办。`, { title: "日程", kind: "warning" });
      return false;
    }
    const timestamp = nowIso();
    const event: CustomEvent = {
      id: uid(),
      userId: state.user.id,
      title,
      description: "",
      date: today,
      repeatDaily: false,
      completedDates: [],
      evidence: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (!repeatDaily) {
      setLocalData((prev) => ({ ...prev, events: [event, ...prev.events] }));
      void saveLocalRecord(state.settings.dataPath, "event", event, state.user.id);
      enqueueDirty([markDirty("event", event.id, event)]);
      return true;
    }
    const template: CustomEvent = {
      ...event,
      id: uid(),
      repeatDaily: true,
      isTemplate: true
    };
    const instance: CustomEvent = {
      ...event,
      id: `${template.id}:${today}`,
      templateId: template.id
    };
    setLocalData((prev) => ({ ...prev, events: [instance, ...prev.events], dailyTemplates: [template, ...prev.dailyTemplates] }));
    void saveLocalRecord(state.settings.dataPath, "daily-template", template, state.user.id);
    void saveLocalRecord(state.settings.dataPath, "event", instance, state.user.id);
    enqueueDirty([markDirty("daily-template", template.id, template), markDirty("event", instance.id, instance)]);
    return true;
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
    setLocalData((prev) => ({ ...prev, events: prev.events.map((item) => (item.id === event.id ? nextEvent : item)) }));
    void saveLocalRecord(state.settings.dataPath, "event", nextEvent, state.user.id);
    enqueueDirty([markDirty("event", nextEvent.id, nextEvent)]);
  };

  const uploadEvidence = async (event: CustomEvent, files: FileList | null) => {
    if (!canEditEvent(event, today)) return;
    const file = files?.[0];
    if (!file) return;
    const dataUrl = await compressImage(file);
    setEvidenceDraft({ eventId: event.id, dataUrl, name: file.name });
  };

  const confirmEvidenceUpload = async () => {
    if (!evidenceDraft?.dataUrl) return;
    const event = localData.events.find((item) => item.id === evidenceDraft.eventId);
    if (!event || !canEditEvent(event, today)) return;
    const evidenceId = uid();
    const stored = await invoke<StoredEvidenceImage>("save_evidence_image", {
      dataDir: state.settings.dataPath.trim(),
      imageId: evidenceId,
      fileName: evidenceDraft.name,
      dataUrl: evidenceDraft.dataUrl
    }).catch(() => null);
    const evidence: EvidenceImage = {
      id: evidenceId,
      name: evidenceDraft.name,
      dataUrl: evidenceDraft.dataUrl,
      filePath: stored?.filePath,
      mimeType: stored?.mimeType,
      size: stored?.size ?? Math.round(evidenceDraft.dataUrl.length * 0.75),
      date: today,
      createdAt: nowIso()
    };
    const nextEvidence = [evidence, ...event.evidence].slice(0, 4);
    const droppedEvidence = event.evidence.filter((image) => !nextEvidence.some((nextImage) => nextImage.id === image.id));
    droppedEvidence.forEach((image) => void deleteEvidenceImage(state.settings.dataPath, image.filePath));
    const nextEvent = { ...event, evidence: nextEvidence, updatedAt: nowIso() };
    setLocalData((prev) => ({ ...prev, events: prev.events.map((item) => (item.id === event.id ? nextEvent : item)) }));
    void saveLocalRecord(state.settings.dataPath, "event", nextEvent, state.user.id);
    enqueueDirty([markDirty("event", nextEvent.id, {
      ...nextEvent,
      deletedEvidenceIds: droppedEvidence.map((image) => image.id)
    })]);
    setEvidenceDraft(null);
  };

  const removeEvidence = (event: CustomEvent, imageId: string) => {
    if (!canEditEvent(event, today)) return;
    const image = event.evidence.find((item) => item.id === imageId);
    const nextEvent = {
      ...event,
      evidence: event.evidence.filter((item) => item.id !== imageId),
      updatedAt: nowIso()
    };
    setLocalData((prev) => ({ ...prev, events: prev.events.map((item) => (item.id === event.id ? nextEvent : item)) }));
    void deleteEvidenceImage(state.settings.dataPath, image?.filePath);
    void saveLocalRecord(state.settings.dataPath, "event", nextEvent, state.user.id);
    enqueueDirty([markDirty("event", nextEvent.id, { ...nextEvent, deletedEvidenceIds: [imageId] })]);
  };

  const removeEvent = (event: CustomEvent) => {
    if (!canEditEvent(event, today)) return;
    const deletedEvent = { ...event, deleted: true, updatedAt: nowIso() };
    setLocalData((prev) => ({
      ...prev,
      events: prev.events.filter((item) => item.id !== event.id)
    }));
    event.evidence.forEach((image) => void deleteEvidenceImage(state.settings.dataPath, image.filePath));
    void deleteLocalRecord(state.settings.dataPath, "event", event.id);
    enqueueDirty([markDirty("event", event.id, deletedEvent)]);
  };

  const removeDailyTemplate = (template: CustomEvent) => {
    const deletedTemplate = { ...template, deleted: true, updatedAt: nowIso() };
    setLocalData((prev) => ({
      ...prev,
      dailyTemplates: prev.dailyTemplates.filter((event) => event.id !== template.id),
      events: prev.events.filter((event) => event.id !== template.id)
    }));
    void deleteLocalRecord(state.settings.dataPath, "daily-template", template.id);
    void deleteLocalRecord(state.settings.dataPath, "event", template.id);
    enqueueDirty([markDirty("daily-template", template.id, deletedTemplate), markDirty("event", template.id, deletedTemplate)]);
  };

  const loginToServer = async () => {
    if (loginBusy) return;
    setLoginBusy(true);
    const applyLoginResult = async (result: Awaited<ReturnType<typeof authDevice>>, serverUrl: string) => {
      const nextSettings = { ...state.settings, serverUrl: normalizeServerUrl(serverUrl) };
      const cloudSnapshot = await fetchUserSnapshot(nextSettings, result.user.id).catch(() => null);
      const cloudActivities = cloudSnapshot?.activities ?? [];
      const cloudBoots = cloudSnapshot?.boots ?? [];
      const cloudEvents = cloudSnapshot?.events ?? [];
      const cloudDailyTemplates = cloudSnapshot?.dailyTemplates ?? [];
      const cloudFriendRatings = cloudSnapshot?.friendRatings ?? [];
      const currentBoot = currentBootRef.current ? { ...currentBootRef.current, userId: result.user.id } : null;
      const hasCloudData = cloudActivities.length > 0 || cloudBoots.length > 0 || cloudEvents.length > 0 || cloudDailyTemplates.length > 0 || cloudFriendRatings.length > 0;
      const importCloudData = hasCloudData && await requestCloudImportChoice({
        activities: cloudActivities.length,
        boots: cloudBoots.length,
        dailyTemplates: cloudDailyTemplates.length,
        events: cloudEvents.length,
        friendRatings: cloudFriendRatings.length
      });
      const importedBoots = currentBoot
        ? [currentBoot, ...cloudBoots.filter((boot) => boot.id !== currentBoot.id)]
        : cloudBoots;
      if (currentBoot) currentBootRef.current = currentBoot;
      const adoptedLocal: LocalDataSnapshot = {
        boots: importCloudData ? importedBoots : localData.boots.map((item) => ({ ...item, userId: result.user.id })),
        activities: importCloudData ? cloudActivities : localData.activities.map((item) => ({ ...item, userId: result.user.id })),
        events: importCloudData ? cloudEvents : localData.events.map((item) => ({ ...item, userId: result.user.id })),
        dailyTemplates: importCloudData ? cloudDailyTemplates : localData.dailyTemplates.map((item) => ({ ...item, userId: result.user.id })),
        friendRatings: importCloudData ? cloudFriendRatings : localData.friendRatings.map((item) => (
          item.raterFriendId === state.user.id ? { ...item, raterFriendId: result.user.id } : item
        ))
      };
      if (importCloudData) {
        localData.boots.forEach((item) => {
          if (item.id !== currentBoot?.id) void deleteLocalRecord(state.settings.dataPath, "boot", item.id);
        });
        localData.activities.forEach((item) => void deleteLocalRecord(state.settings.dataPath, "activity", item.id));
        localData.events.forEach((item) => void deleteLocalRecord(state.settings.dataPath, "event", item.id));
        localData.dailyTemplates.forEach((item) => void deleteLocalRecord(state.settings.dataPath, "daily-template", item.id));
        localData.friendRatings.forEach((item) => void deleteLocalRecord(state.settings.dataPath, "friend-rating", item.id));
      }
      setLocalData(adoptedLocal);
      [
        ...adoptedLocal.boots.map((item) => ({ kind: "boot" as const, item })),
        ...adoptedLocal.activities.map((item) => ({ kind: "activity" as const, item })),
        ...adoptedLocal.events.map((item) => ({ kind: "event" as const, item })),
        ...adoptedLocal.dailyTemplates.map((item) => ({ kind: "daily-template" as const, item })),
        ...adoptedLocal.friendRatings.map((item) => ({ kind: "friend-rating" as const, item }))
      ].forEach(({ kind, item }) => void saveLocalRecord(state.settings.dataPath, kind, item, result.user.id));
      setState((prev) => {
        const adopted = applyUserIdToLocalData(prev, result.user.id);
        const dirtyRecords = [
          markDirty("user", result.user.id, result.user),
          ...(importCloudData && currentBoot ? [markDirty("boot", currentBoot.id, currentBoot)] : adoptedLocal.boots.map((item) => markDirty("boot", item.id, item))),
          ...(importCloudData ? [] : adoptedLocal.activities.map((item) => markDirty("activity", item.id, item))),
          ...(importCloudData ? [] : adoptedLocal.events.map((item) => markDirty("event", item.id, item))),
          ...(importCloudData ? [] : adoptedLocal.dailyTemplates.map((item) => markDirty("daily-template", item.id, item))),
          ...(importCloudData ? [] : adoptedLocal.friendRatings.map((item) => markDirty("friend-rating", item.id, item)))
        ];
        const next = {
          ...adopted,
          settings: { ...adopted.settings, serverUrl: nextSettings.serverUrl },
          user: result.user,
          cloudSession: {
            machineKey: result.machineKey,
            loggedInAt: nowIso()
          },
          dirtyQueue: dirtyRecords
        };
        saveState(next);
        return next;
      });
    };
    setLoginStatus("正在使用本机设备登录...");
    setServerStatus("登录中...");
    try {
      const result = await authDevice(state.settings, state.user);
      await applyLoginResult(result, state.settings.serverUrl);
      setLoginStatus(result.status === "created" ? "已创建并登录本设备账号" : "已登录本设备账号");
      setServerStatus("已登录服务器");
      void refreshFriends();
    } catch {
      try {
        setLoginStatus("登录失败，正在尝试获取最新服务器...");
        const discovered = await discoverServer();
        if (!discovered) throw new Error("server discovery disabled");
        const result = await authDevice(discovered, state.user);
        await applyLoginResult(result, discovered.serverUrl);
        setLoginStatus(result.status === "created" ? "已通过最新服务器创建并登录" : "已通过最新服务器登录");
        setServerStatus("已切换到最新服务器");
        void refreshFriends();
      } catch {
        setLoginStatus("登录失败，请检查服务器地址");
        setServerStatus("登录失败");
      }
    } finally {
      setLoginBusy(false);
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

  const addFriendRating = async (date = yesterdayKey()) => {
    if (!isArchiveClosed(date) || !selectedFriendData) return;
    const ratingDay = selectedFriendDays.find((day) => day.date === date);
    const eventIds = ratingDay?.events.map((event) => event.id) ?? [];
    if (eventIds.length === 0) {
      setFriendStatus("这天还没有同步到好友待办，不能评分");
      notifications.notify("需要好友先同步这一天的待办数据，之后才能评分。", { title: "好友评分", kind: "warning" });
      return;
    }
    const rating: FriendRating = {
      id: `${state.user.id}:${selectedFriendData.id}:${date}`,
      targetUserId: selectedFriendData.id,
      raterFriendId: state.user.id,
      date,
      rank: friendRatingRank,
      comment: friendRatingComment.trim(),
      eventIds,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const dirty = markDirty("friend-rating", rating.id, rating);
    if (state.cloudSession) {
      setFriendStatus("正在提交评分到服务器...");
      try {
        await syncChanges(state.settings, state.user, [dirty]);
        await refreshServerFriendRatings();
        await loadFriendDays(selectedFriendData.id);
        setFriendStatus("评分已按服务器数据刷新");
        return;
      } catch {
        setFriendStatus("服务器暂时不可用，评分已保留到本地待同步");
      }
    }
    setLocalData((prev) => ({
      ...prev,
      friendRatings: [rating, ...prev.friendRatings.filter((item) => item.id !== rating.id)]
    }));
    void saveLocalRecord(state.settings.dataPath, "friend-rating", rating, state.user.id);
    enqueueDirty([dirty]);
  };

  const updateSettings = async (nextSettings: AppSettings) => {
    const dataPathChanged = nextSettings.dataPath !== state.settings.dataPath;
    if (dataPathChanged) {
      const targetStatus = await invoke<DataDirStatus>("data_dir_status", {
        dataDir: nextSettings.dataPath.trim()
      }).catch(() => null);
      if (targetStatus?.hasDatabase && !targetStatus.isDaynekoData) {
        notifications.notify("目标路径存在非 DayNeko 数据库，请选择空目录或已有 DayNeko 数据目录。", { title: "设置", kind: "warning" });
        return false;
      }
      if (targetStatus?.isDaynekoData) {
        const choice = await requestDataPathConflictChoice(nextSettings.dataPath);
        if (choice === "cancel") {
          notifications.notify("已撤销数据路径切换。", { title: "设置" });
          return false;
        }
        if (choice === "use-existing") {
          const existing = await loadStoredState(nextSettings.dataPath);
          const next = existing
            ? { ...existing, settings: { ...existing.settings, dataPath: nextSettings.dataPath } }
            : { ...state, settings: nextSettings };
          setState(next);
          saveStatePointer(next);
          notifications.notify(`已切换到已有数据路径：${nextSettings.dataPath}`, { title: "设置", kind: "success" });
          return true;
        }
      }
      await invoke("migrate_data_dir", {
        fromDataDir: state.settings.dataPath.trim(),
        toDataDir: nextSettings.dataPath.trim(),
        overwrite: Boolean(targetStatus?.isDaynekoData || targetStatus?.hasEvidence)
      }).catch(() => undefined);
    }
    patchState((prev) => ({ ...prev, settings: nextSettings }));
    if (dataPathChanged) {
      notifications.notify(nextSettings.dataPath.trim() ? `数据路径已更新：${nextSettings.dataPath}` : "数据路径已清空，将仅使用本地缓存", {
        title: "设置"
      });
    }
    void invoke("set_close_to_tray", { enabled: nextSettings.closeToTray }).catch(() => undefined);
    try {
      const mod = await import("@tauri-apps/plugin-autostart");
      if (nextSettings.autoStart) await mod.enable();
      else await mod.disable();
    } catch {
      // Browser preview does not have Tauri plugin APIs.
    }
    return true;
  };

  const updateProfile = (user: UserProfile) => {
    patchState((prev) => ({ ...prev, user }), [markDirty("user", user.id, user)]);
  };

  const runServerTest = async () => {
    if (serverTestBusy) return;
    setServerTestBusy(true);
    setServerStatus("测试中...");
    try {
      const result = await testServer(state.settings);
      const snapshot = state.cloudSession
        ? await fetch(`${normalizeServerUrl(state.settings.serverUrl)}/users/${state.user.id}/snapshot`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
        : null;
      if (state.cloudSession && snapshot?.friendRatings?.length) {
        setLocalData((prev) => {
          const friendRatings = snapshot.friendRatings?.length ? snapshot.friendRatings as FriendRating[] : prev.friendRatings;
          friendRatings.map((item) => ({ kind: "friend-rating" as const, item }))
            .forEach(({ kind, item }) => void saveLocalRecord(state.settings.dataPath, kind, item, state.user.id));
          return { ...prev, friendRatings };
        });
      }
      setServerStatus(result.status === "ok" ? "连接正常" : "服务器有响应");
    } catch {
      try {
        setServerStatus("连接失败，正在获取最新服务器...");
        const discovered = await discoverServer();
        if (!discovered) throw new Error("server discovery disabled");
        const result = await testServer(discovered);
        setServerStatus(result.status === "ok" ? "已切换到最新服务器，连接正常" : "已切换到最新服务器");
      } catch {
        setServerStatus("连接失败");
      }
    } finally {
      setServerTestBusy(false);
    }
  };

  const normalizeUpdateError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (/network|fetch|request|dns|resolve|timeout|timed out/i.test(message)) return "检查更新失败：无法访问更新服务，请检查网络后重试";
    if (/signature|pubkey|verify/i.test(message)) return "检查更新失败：更新签名校验未通过";
    return message ? `检查更新失败：${message}` : "检查更新失败，请稍后重试";
  };

  const toUpdateInfo = async (update: Update): Promise<UpdateInfo> => {
    const releaseNotes = await fetchGitHubReleaseNotes(update.version).catch(() => null);
    return {
      currentVersion: update.currentVersion || appVersion,
      latestVersion: update.version,
      hasUpdate: true,
      title: `DayNeko ${update.version}`,
      notes: releaseNotes || update.body || "这个版本没有填写更新日志。",
      url: "",
      publishedAt: update.date,
      assets: []
    };
  };

  const openUpdateWindow = async (info: UpdateInfo) => {
    localStorage.setItem(sharedAccentColorKey, state.settings.accentColor);
    localStorage.setItem(pendingUpdateInfoKey, JSON.stringify(info));
    const existing = await WebviewWindow.getByLabel("update-prompt");
    if (existing) {
      await existing.show();
      await existing.unminimize();
      await existing.setFocus();
      return;
    }
    const updateWindow = new WebviewWindow("update-prompt", {
      url: "/update.html",
      title: "DayNeko 更新",
      width: 720,
      height: 620,
      minWidth: 520,
      minHeight: 480,
      resizable: true,
      decorations: false,
      focus: true,
      visible: true,
      alwaysOnTop: true
    });
    updateWindow.once("tauri://error", (event) => {
      console.error("Failed to open update window", event.payload);
      setUpdateStatus("发现新版本，但更新窗口打开失败");
    });
  };

  const runUpdateCheck = async (source: "manual" | "startup" = "manual") => {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateStatus("正在检查更新...");
    try {
      const update = await check();
      if (!update) {
        setUpdateStatus("当前已经是最新版本");
        return;
      }
      const result = await toUpdateInfo(update);
      setUpdateStatus(`发现新版本 ${result.latestVersion}`);
      const skippedVersion = localStorage.getItem(skippedUpdateVersionKey);
      if (source === "manual" || skippedVersion !== result.latestVersion) {
        await openUpdateWindow(result);
      }
    } catch (error) {
      console.error("Update check failed", error);
      setUpdateStatus(normalizeUpdateError(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  React.useEffect(() => {
    const timer = window.setTimeout(() => void runUpdateCheck("startup"), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
    <WindowChrome title="DayNeko" />
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
            doneCount={doneCount}
            eventCount={visibleEvents.length}
            latestRating={latestRating}
            cloudLoggedIn={cloudLoggedIn}
            presence={presence}
            pendingFriendRequests={state.friendRequests.filter((request) => request.toUserId === state.user.id && request.status === "pending").length}
            pendingRatingDays={recentRatingFriendDays.filter((day) =>
              day.events.length > 0
              && isArchiveClosed(day.date)
              && !localData.friendRatings.some((rating) => rating.targetUserId === selectedFriendData?.id && rating.date === day.date)
            ).length}
            serverStatus={serverStatus}
            state={stateWithLocalData}
            events={visibleEvents}
            onLogin={loginToServer}
            onToggleEvent={toggleEvent}
          />
        )}
        {page === "time" && <TimePage activities={localData.activities} availableDates={timeDates} boots={localData.boots} onDateChange={loadTimeDate} />}
        {page === "events" && (
          <EventsPage
            events={visibleEvents}
            allEvents={localData.events}
            dailyTemplates={localData.dailyTemplates}
            friends={state.friends}
            ratings={receivedRatings}
            month={scheduleMonth}
            today={today}
            onAddEvent={addEvent}
            onEvidence={uploadEvidence}
            onMonthChange={changeScheduleMonth}
            onRemoveEvidence={removeEvidence}
            onStartEvidence={(event) => setEvidenceDraft({ eventId: event.id, name: "pasted-image.jpg" })}
            onOpenEvidence={(event, index, date) => setEvidenceSelection({ eventId: event.id, index, date })}
            onRemoveDailyTemplate={removeDailyTemplate}
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
            ratings={localData.friendRatings}
            currentUser={state.user}
            selectedFriend={selectedFriend}
            ratingRank={friendRatingRank}
            ratingComment={friendRatingComment}
            onAddFriend={addFriend}
            onAddRating={addFriendRating}
            onHandleRequest={handleFriendRequest}
            onFriendHandle={setFriendHandle}
            onLoadMoreDays={() => selectedFriendData && void loadFriendDays(selectedFriendData.id, "append")}
            onOpenEvidence={(event, index, date) => setEvidenceSelection({ eventId: event.id, index, date })}
            onRatingComment={setFriendRatingComment}
            onRatingRank={setFriendRatingRank}
            onSelectFriend={setSelectedFriend}
          />
        )}
        {page === "leaderboard" && (
          <LeaderboardPage
            entries={leaderboardEntries.length ? leaderboardEntries : buildLeaderboard(stateWithLocalData, leaderboardScope)}
            scope={leaderboardScope}
            onScope={setLeaderboardScope}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            cloudLoggedIn={cloudLoggedIn}
            loginStatus={loginStatus}
            loginBusy={loginBusy}
            settings={state.settings}
            serverTestBusy={serverTestBusy}
            serverStatus={serverStatus}
            updateBusy={updateBusy}
            updateStatus={updateStatus}
            user={state.user}
            onAvatarSelected={(dataUrl) => setAvatarCrop({ dataUrl, scale: 1, x: 50, y: 50 })}
            onCheckUpdate={runUpdateCheck}
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
              <div className="avatar">{friend.avatar ? <img src={friend.avatar} alt="" /> : friend.name.slice(0, 1).toUpperCase()}</div>
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
            {selectedFriendForeground && <p>{selectedFriendForeground}</p>}
            <span>{selectedFriendOnline ? "在线" : "离线"} · {selectedFriendData.mood} · {fmtTime(selectedFriendData.lastSeen)}</span>
          </div>
        )}
      </aside>
      <EvidenceViewer
        events={[...localData.events, ...visibleFriendEvents]}
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
      <AvatarCropDialog
        draft={avatarCrop}
        onChange={setAvatarCrop}
        onClose={() => setAvatarCrop(null)}
        onConfirm={(avatar) => {
          updateProfile({ ...state.user, avatar });
          setAvatarCrop(null);
        }}
      />
      {cloudImportPrompt && (
        <div className="cloud-import-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-import-title">
          <div className="cloud-import-backdrop" />
          <section className="cloud-import-panel">
            <header>
              <div>
                <span className="section-kicker">Cloud Data</span>
                <h2 id="cloud-import-title">检测到云端已有数据</h2>
                <p>选择这台设备首次登录后的数据来源。</p>
              </div>
            </header>
            <div className="cloud-import-body">
              <dl className="cloud-import-counts">
                <div><dt>日程</dt><dd>{cloudImportPrompt.events}</dd></div>
                <div><dt>每日循环</dt><dd>{cloudImportPrompt.dailyTemplates}</dd></div>
                <div><dt>好友评分</dt><dd>{cloudImportPrompt.friendRatings}</dd></div>
                <div><dt>时间活动</dt><dd>{cloudImportPrompt.activities}</dd></div>
                <div><dt>启动记录</dt><dd>{cloudImportPrompt.boots}</dd></div>
              </dl>
              <p>使用云端数据会覆盖本地日程和时间地图；保留本地数据则会把本机内容作为权威来源同步到云端。</p>
            </div>
            <footer>
              <button className="primary-button accent-soft" type="button" autoFocus onClick={() => resolveCloudImportChoice(false)}>
                <HardDrive size={17} />
                保留本地数据
              </button>
              <button className="primary-button" type="button" onClick={() => resolveCloudImportChoice(true)}>
                <CloudDownload size={17} />
                使用云端数据
              </button>
            </footer>
          </section>
        </div>
      )}
      {dataPathConflict && (
        <div className="data-path-dialog" role="dialog" aria-modal="true">
          <button className="data-path-dialog-backdrop" onClick={() => resolveDataPathConflictChoice("cancel")} />
          <section className="data-path-dialog-panel">
            <header>
              <span className="section-kicker">Data Path</span>
              <h2>检测到目标路径已有 DayNeko 数据</h2>
            </header>
            <p>你选择的目录已经包含 DayNeko 数据。请选择接下来要怎么处理：</p>
            <div className="data-path-target">{dataPathConflict.path}</div>
            <div className="data-path-actions">
              <button type="button" onClick={() => resolveDataPathConflictChoice("use-existing")}>使用已有数据</button>
              <button type="button" onClick={() => resolveDataPathConflictChoice("overwrite")}>迁移并覆盖</button>
              <button className="primary-button" type="button" autoFocus onClick={() => resolveDataPathConflictChoice("cancel")}>撤销</button>
            </div>
          </section>
        </div>
      )}
      <AppNotifications items={notifications.items} onDismiss={notifications.dismiss} />
      <GlobalTooltip />
      <FloatingScrollbar targetRef={appShellRef} />
    </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
