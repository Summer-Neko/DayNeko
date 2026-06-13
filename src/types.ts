export type Page = "home" | "time" | "events" | "friends" | "leaderboard" | "settings";
export type ThemeMode = "light" | "dark";
export type Language = "zh-CN" | "en-US";
export type FontSize = "small" | "medium" | "large";
export type Rank = "SSS" | "S" | "A" | "B" | "C";
export type LeaderboardScope = "7d" | "all";
export type DirtyKind = "user" | "boot" | "activity" | "event" | "friend" | "friend-rating" | "presence";

export type UserProfile = {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  machineKey?: string;
};

export type AppSettings = {
  serverUrl: string;
  autoStart: boolean;
  silentRun: boolean;
  closeToTray: boolean;
  theme: ThemeMode;
  language: Language;
  fontSize: FontSize;
  accentColor: string;
  dataPath: string;
  background?: string;
  backgroundBrightness: number;
  cardOpacity: number;
  cardBlur: number;
  cardShadow: number;
  syncIntervalSeconds: number;
  autoDiscoverServer: boolean;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
};

export type DirtyRecord = {
  id: string;
  kind: DirtyKind;
  payload: unknown;
  changedAt: string;
};

export type ActivityEntry = {
  id: string;
  userId: string;
  label: string;
  mood: string;
  startedAt: string;
  endedAt?: string;
  source: "manual" | "auto";
  updatedAt: string;
};

export type BootEvent = {
  id: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  device: string;
  updatedAt: string;
};

export type EvidenceImage = {
  id: string;
  name: string;
  dataUrl: string;
  filePath?: string;
  mimeType?: string;
  size: number;
  date?: string;
  createdAt: string;
};

export type CustomEvent = {
  id: string;
  userId: string;
  title: string;
  description: string;
  date: string;
  repeatDaily: boolean;
  isTemplate?: boolean;
  templateId?: string;
  completedDates: string[];
  evidence: EvidenceImage[];
  createdAt: string;
  updatedAt: string;
};

export type Friend = {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  status: string;
  mood: string;
  detail?: string;
  foregroundTitle?: string;
  foregroundProcess?: string;
  lastSeen: string;
  updatedAt: string;
};

export type FriendRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromName: string;
  fromHandle: string;
  toName: string;
  toHandle: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
};

export type FriendRating = {
  id: string;
  targetUserId: string;
  raterFriendId: string;
  date: string;
  rank: Rank;
  comment: string;
  eventIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type LeaderboardEntry = {
  userId: string;
  name: string;
  handle: string;
  rank: Rank;
  score: number;
  completed: number;
  ratedDays: number;
};

export type AppState = {
  user: UserProfile;
  cloudSession?: {
    serverUrl: string;
    machineKey: string;
    loggedInAt: string;
  };
  settings: AppSettings;
  dirtyQueue: DirtyRecord[];
  lastSyncedAt?: string;
  boots: BootEvent[];
  activities: ActivityEntry[];
  events: CustomEvent[];
  friends: Friend[];
  friendRequests: FriendRequest[];
  friendRatings: FriendRating[];
};

export type EvidenceSelection = {
  eventId: string;
  index: number;
  date?: string;
};

export type EvidenceDraft = {
  eventId: string;
  dataUrl?: string;
  name: string;
};

export type AvatarCropDraft = {
  dataUrl: string;
  scale: number;
  x: number;
  y: number;
};

export type FriendDay = {
  date: string;
  events: CustomEvent[];
  ratings: FriendRating[];
  activities: Array<ActivityEntry & { minutes?: number }>;
  totalMinutes: number;
};

export type ForegroundActivity = {
  title: string;
  process: string;
};

export type AutoActivity = {
  key: string;
  label: string;
  mood: string;
};

export type PresenceStatus = {
  id: string;
  userId: string;
  label: string;
  mood: string;
  detail: string;
  foregroundTitle: string;
  foregroundProcess: string;
  online: boolean;
  updatedAt: string;
};

export type DeviceAuthResult = {
  status: "created" | "logged-in";
  user: UserProfile;
};

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  title: string;
  notes: string;
  url: string;
  publishedAt?: string;
  assets: Array<{
    name: string;
    size: number;
    downloadUrl: string;
  }>;
};
